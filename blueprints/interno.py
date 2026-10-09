"""
blueprints/interno.py
---------------------
API JSON interna para la app Next.js: las cuatro herramientas de datos y los
reportes guardados, sin pantallas.

La reescritura pasa todo a JavaScript menos el analisis de datos, que sigue
aqui. Este blueprint es la puerta: reutiliza los servicios de siempre
(meltwater_ingest, calculation, classifier, file_merger, csv_analysis) y solo
anade lo que la web necesita para no dejar a nadie a ciegas: los procesos
largos son trabajos con fase y progreso real (services/trabajos.py).

Autenticacion de servicio a servicio, no de navegador:

  Authorization: Bearer <ANALYTICS_TOKEN>   comparado en tiempo constante
  X-Usuario-Id: <id>                        el usuario de la sesion de Next

Con el usuario cargado se aplican los mismos permisos que en las paginas
Flask: herramientas permitidas y propiedad de reportes, sesiones y descargas.
Sin token valido, 401. Va exento de CSRF (no hay cookie que robar) y del
limite global por IP (todo llega desde la IP de Next; el sondeo de un
proceso son 60 peticiones por minuto).
"""
import functools
import hmac
import io
import json
import os
import time
import uuid

import pandas as pd
from flask import Blueprint, current_app, g, jsonify, request, send_file
from flask_login import current_user
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.utils import secure_filename

from extensions import db
from models import Report, TempArtifact, User
from services import reportes as reportes_svc
from services import trabajos as trabajos_svc
from services.trabajos import ErrorDeTrabajo

interno_bp = Blueprint('interno', __name__, url_prefix='/api/interno')

MB = 1024 * 1024

# Limites por herramienta. La app Next valida los mismos antes de subir
# (web/src/lib/datos/limites.ts): mantenlos en sincronia.
LIMITES = {
    'reports': 60 * MB,          # diez widgets .xlsx pesan unos pocos KB cada uno
    'classification': 150 * MB,
    'file_merge': 200 * MB,      # suma de todos los archivos
    'csv_analysis': 150 * MB,
}
EXTENSIONES = {
    'reports': {'xlsx'},
    'classification': {'csv', 'txt', 'xlsx', 'xls'},
    'file_merge': {'csv', 'txt', 'xlsx', 'xls'},
    'csv_analysis': {'csv', 'txt'},
}
# Para la vista previa basta el principio de un CSV: no hace falta leer 100 MB
# para ensenar cinco filas.
BYTES_VISTA_PREVIA = 2 * MB
FILAS_POR_LOTE = 2000

# Cuantas veces por hora alguien puede pedir textos al modelo (cada una se
# paga). Igual que el '10 per hour' de /api/reportes/<token>/insights.
LIMITE_IA_HORA = 10
_llamadas_ia = {}

_registro = None


def registro():
    """El registro de trabajos de este proceso, creado al primer uso."""
    global _registro
    if _registro is None:
        raiz = os.path.abspath(current_app.config.get('UPLOAD_FOLDER', 'scratch'))
        _registro = trabajos_svc.Registro(
            raiz,
            max_workers=int(os.environ.get('ANALYTICS_WORKERS', '2') or 2),
            max_por_usuario=int(os.environ.get('ANALYTICS_TRABAJOS_POR_USUARIO', '3') or 3),
        )
    return _registro


def _error(status, mensaje, **extra):
    return jsonify({'error': mensaje, **extra}), status


# ─────────────────────────────────────────────────────────────
# Autenticacion de servicio y permisos
# ─────────────────────────────────────────────────────────────

@interno_bp.before_request
def _autenticar():
    esperado = os.environ.get('ANALYTICS_TOKEN') or current_app.config.get('ANALYTICS_TOKEN') or ''
    cabecera = request.headers.get('Authorization', '')
    recibido = cabecera[7:] if cabecera.startswith('Bearer ') else ''
    # Sin token configurado la puerta queda cerrada, no abierta.
    if not esperado or not hmac.compare_digest(recibido.encode('utf-8'), esperado.encode('utf-8')):
        return _error(401, 'Token de servicio no válido.')

    crudo = (request.headers.get('X-Usuario-Id') or '').strip()
    # Solo digitos ASCII y dentro de un INTEGER de PostgreSQL: str.isdigit()
    # acepta '²' (int() falla: 500) y un numero enorme desborda la consulta.
    if not (crudo.isascii() and crudo.isdigit()) or len(crudo) > 10 or int(crudo) > 2**31 - 1:
        return _error(401, 'Falta el usuario de la sesión.')
    usuario = db.session.get(User, int(crudo))
    if usuario is None or not usuario.is_active:
        return _error(401, 'Usuario no válido o desactivado.')
    # flask_login lee el usuario de g: con esto current_user, log_activity y
    # el registro de consumo de IA funcionan igual que en una pagina.
    g._login_user = usuario
    return None


def herramienta(clave):
    def envoltorio(f):
        @functools.wraps(f)
        def decorada(*args, **kwargs):
            if not current_user.has_tool_access(clave):
                return _error(403, 'No tienes acceso a esta herramienta.')
            return f(*args, **kwargs)
        return decorada
    return envoltorio


@interno_bp.errorhandler(RequestEntityTooLarge)
def _demasiado_grande(_e):
    return _error(413, 'El archivo supera el tamaño máximo permitido.')


@interno_bp.errorhandler(HTTPException)
def _http(e):
    return _error(e.code or 500, e.description or 'Error')


def _comprobar_tamano(clave):
    """413 antes de leer el cuerpo si el Content-Length ya lo delata."""
    largo = request.content_length
    if largo is not None and largo > LIMITES[clave]:
        limite = LIMITES[clave] // MB
        return _error(413, f'Los archivos superan el máximo de {limite} MB.')
    return None


def _extension(nombre):
    return nombre.lower().rsplit('.', 1)[-1] if '.' in (nombre or '') else ''


def _validar_archivo(clave, archivo):
    if archivo is None or not archivo.filename:
        return 'No se recibió ningún archivo.'
    if _extension(archivo.filename) not in EXTENSIONES[clave]:
        permitidas = ', '.join(f'.{e}' for e in sorted(EXTENSIONES[clave]))
        return f'«{archivo.filename}» no es un tipo admitido ({permitidas}).'
    return None


def _guardar_en(trabajo, archivo, nombre=None):
    """Guarda una subida en la carpeta del trabajo. Werkzeug ya la tiene en disco."""
    destino = os.path.join(trabajo.entrada, f'{uuid.uuid4().hex[:8]}_{secure_filename(nombre or archivo.filename) or "archivo"}')
    archivo.save(destino)
    return destino


def _bool(valor, defecto=False):
    if valor is None:
        return defecto
    return str(valor).strip().lower() in ('1', 'true', 'si', 'sí', 'on', 'yes')


def _nuevo_trabajo(tipo):
    reg = registro()
    if len(reg.activos_de(current_user.id)) >= reg.max_por_usuario:
        return None, _error(429, 'Ya tienes varios procesos en marcha. Espera a que termine alguno.')
    return reg.crear(tipo, current_user.id), None


def _lanzar(trabajo, funcion):
    app = current_app._get_current_object()
    registro().lanzar(trabajo, funcion, app, sincrono=bool(app.config.get('INTERNO_SINCRONO')))
    delante = registro().en_cola_delante(trabajo)
    if delante and trabajo.estado == trabajos_svc.EN_COLA:
        trabajo.mensaje = f'En cola: {delante} proceso(s) delante'
        trabajo.guardar()
    return jsonify({'trabajo': trabajo.id, 'estado': trabajo.publico()}), 202


def _registrar_artefacto(kind, file_id, storage_name):
    artefacto = TempArtifact.query.filter_by(kind=kind, file_id=file_id).first()
    if artefacto is None:
        db.session.add(TempArtifact(kind=kind, file_id=file_id,
                                    storage_name=storage_name, user_id=current_user.id))
    else:
        artefacto.storage_name = storage_name
        artefacto.user_id = current_user.id
    db.session.commit()


def _ruta_scratch(nombre):
    return os.path.join(os.path.abspath(current_app.config.get('UPLOAD_FOLDER', 'scratch')), nombre)


def _log(accion, detalle):
    from blueprints.admin import log_activity
    log_activity(accion, detalle, user_id=current_user.id)


@interno_bp.route('/salud')
def salud():
    return jsonify({'ok': True, 'usuario': current_user.id,
                    'herramientas': current_user.get_allowed_tools()})


# ─────────────────────────────────────────────────────────────
# Estado de los trabajos
# ─────────────────────────────────────────────────────────────

_HERRAMIENTA_DE_TIPO = {
    'reporte': 'reports', 'insights': 'reports', 'clasificacion': 'classification',
    'union': 'file_merge', 'analisis': 'csv_analysis',
}


def _trabajo_propio(trabajo_id):
    datos = registro().obtener(trabajo_id)
    # Lo de otro no existe para ti: 404, ni siquiera 403.
    if datos is None or (datos.get('user_id') != current_user.id and not current_user.is_admin):
        return None
    if not current_user.has_tool_access(_HERRAMIENTA_DE_TIPO.get(datos.get('tipo'), '')):
        return None
    return datos


@interno_bp.route('/trabajos/<trabajo_id>')
def ver_trabajo(trabajo_id):
    datos = _trabajo_propio(trabajo_id)
    if datos is None:
        return _error(404, 'Ese proceso no existe o ya caducó.')
    datos.pop('user_id', None)
    return jsonify(datos)


@interno_bp.route('/trabajos/<trabajo_id>/cancelar', methods=['POST'])
def cancelar_trabajo(trabajo_id):
    datos = _trabajo_propio(trabajo_id)
    if datos is None:
        return _error(404, 'Ese proceso no existe o ya caducó.')
    if datos.get('estado') in trabajos_svc.TERMINALES:
        return _error(409, 'El proceso ya terminó.')
    registro().cancelar(trabajo_id)
    return jsonify({'ok': True}), 202


# ─────────────────────────────────────────────────────────────
# Reportes de escucha social
# ─────────────────────────────────────────────────────────────

def _periodo(contexto):
    etiquetas = ((contexto.get('charts') or {}).get('evolution') or {}).get('labels') or []
    if not etiquetas:
        return None
    return f'{etiquetas[0]} – {etiquetas[-1]}' if len(etiquetas) > 1 else str(etiquetas[0])


def _fecha_iso(valor):
    return valor.isoformat() + 'Z' if valor else None


@interno_bp.route('/reportes')
@herramienta('reports')
def listar_reportes():
    """Mis reportes, del mas reciente al mas antiguo. Solo los propios."""
    q = (request.args.get('q') or '').strip().lower()
    filas = (Report.query.filter_by(user_id=current_user.id)
             .order_by(Report.created_at.desc()).limit(500).all())
    salida = []
    for r in filas:
        contexto = None
        try:
            contexto = r.contexto
        except ValueError:
            contexto = None
        cliente = ((contexto or {}).get('meta') or {}).get('client_name') or r.title or ''
        fila = {
            'token': r.token,
            'titulo': r.title or cliente or 'Reporte sin nombre',
            'cliente': cliente,
            'periodo': _periodo(contexto) if contexto else None,
            'menciones': ((contexto or {}).get('kpis') or {}).get('total_mentions'),
            'creado': _fecha_iso(r.created_at),
            'actualizado': _fecha_iso(r.updated_at),
            'estado_ia': r.insights_status,
            'fuente': r.insights_source or 'reglas',
            'disponible': contexto is not None,
        }
        if q and q not in f"{fila['titulo']} {fila['cliente']} {fila['periodo'] or ''}".lower():
            continue
        salida.append(fila)
    return jsonify({'reportes': salida})


@interno_bp.route('/reportes/<token>')
@herramienta('reports')
def ver_reporte(token):
    guardado = Report.query.filter_by(token=token).first()
    if guardado is None:
        return _error(404, 'Ese reporte no existe.')
    contexto = guardado.contexto
    if contexto is None:
        return _error(410, 'Ese reporte se generó con una versión anterior y no se guardó su contenido.')
    contexto['insights_source'] = guardado.insights_source or 'reglas'
    return jsonify({
        'token': guardado.token,
        'titulo': guardado.title,
        'contexto': contexto,
        'vista': reportes_svc.vista_de_reporte(contexto),
        'puede_editar': reportes_svc.puede_editar(guardado, current_user),
        'es_propio': guardado.user_id == current_user.id,
        'estado_ia': guardado.insights_status,
        'fuente': guardado.insights_source or 'reglas',
        'error_ia': guardado.insights_error,
        'editados': sorted(guardado.slots_editados()),
        'creado': _fecha_iso(guardado.created_at),
        'actualizado': _fecha_iso(guardado.updated_at),
    })


@interno_bp.route('/reportes/<token>/textos', methods=['POST'])
@herramienta('reports')
def guardar_textos(token):
    guardado = Report.query.filter_by(token=token).first()
    if guardado is None:
        return _error(404, 'Ese reporte no existe.')
    if not reportes_svc.puede_editar(guardado, current_user):
        return _error(403, 'Este reporte no es tuyo.')
    entrantes = (request.get_json(silent=True) or {}).get('textos')
    guardados = reportes_svc.guardar_retoques(guardado, entrantes)
    if guardados is None:
        return _error(400, 'Nada que guardar.')
    return jsonify({'ok': True, 'guardados': guardados})


def _permitir_ia(user_id):
    ahora = time.time()
    lista = [t for t in _llamadas_ia.get(user_id, []) if ahora - t < 3600]
    if len(lista) >= LIMITE_IA_HORA:
        _llamadas_ia[user_id] = lista
        return False
    lista.append(ahora)
    _llamadas_ia[user_id] = lista
    return True


@interno_bp.route('/reportes/<token>/insights', methods=['POST'])
@herramienta('reports')
def pedir_insights(token):
    """Textos del modelo para un reporte ya guardado, como trabajo con progreso."""
    guardado = Report.query.filter_by(token=token).first()
    if guardado is None:
        return _error(404, 'Ese reporte no existe.')
    if not reportes_svc.puede_editar(guardado, current_user):
        return _error(403, 'Este reporte no es tuyo.')
    if guardado.insights_status == Report.INSIGHTS_LISTO:
        return jsonify({'trabajo': None, 'resultado': reportes_svc.pedir_insights(guardado)})
    if not guardado.context_json:
        return _error(400, 'El reporte no tiene contenido guardado.')
    if not _permitir_ia(current_user.id):
        return _error(429, 'Has pedido muchos textos a la IA en la última hora. Prueba más tarde.')

    trabajo, error = _nuevo_trabajo('insights')
    if error:
        return error
    reporte_id = guardado.id

    def ejecutar(t):
        t.avisar('ia', None, 'Redactando los textos del reporte')
        fila = db.session.get(Report, reporte_id)
        respuesta = reportes_svc.pedir_insights(fila)
        t.avisar('guardado', 100, 'Textos guardados')
        return respuesta

    return _lanzar(trabajo, ejecutar)


class _SubidaConAviso:
    """Un archivo que avisa al leerse.

    load_widget_bulk lee los archivos uno a uno; envolverlos asi da un
    progreso real de la carga sin tocar el servicio.
    """

    def __init__(self, ruta, nombre, avisar):
        self.ruta = ruta
        self.filename = nombre
        self._avisar = avisar

    def read(self):
        self._avisar(self.filename)
        with open(self.ruta, 'rb') as f:
            return f.read()


@interno_bp.route('/reportes/previsualizar', methods=['POST'])
@herramienta('reports')
def previsualizar_reporte():
    """Que widget es cada archivo, antes de generar nada."""
    from services import meltwater_ingest as mi

    demasiado = _comprobar_tamano('reports')
    if demasiado:
        return demasiado
    salida = []
    vistos = set()
    for archivo in request.files.getlist('archivos'):
        problema = _validar_archivo('reports', archivo)
        fila = {'nombre': archivo.filename, 'widget': None, 'etiqueta': None, 'hoja': None, 'error': problema}
        if not problema:
            crudo = archivo.read()
            try:
                hojas = pd.ExcelFile(io.BytesIO(crudo)).sheet_names
                hoja = hojas[0] if hojas else ''
            except Exception:
                hoja = None
            if hoja is None:
                fila['error'] = 'No se pudo abrir como Excel (.xlsx).'
            else:
                fila['hoja'] = hoja
                clave = mi.SHEET_TYPE_MAP.get((hoja or '').strip().lower())
                if clave is None:
                    fila['error'] = f'No es un widget reconocido: su hoja se llama «{hoja}».'
                elif clave in vistos:
                    fila['widget'] = clave
                    fila['etiqueta'] = mi.WIDGET_LABELS[clave]
                    fila['error'] = f'Ya hay otro «{mi.WIDGET_LABELS[clave]}»; este se ignorará.'
                else:
                    _df, error = mi.validate_widget(clave, crudo, archivo.filename)
                    fila['widget'] = clave
                    fila['etiqueta'] = mi.WIDGET_LABELS[clave]
                    fila['error'] = error
                    if not error:
                        vistos.add(clave)
        salida.append(fila)
    faltan = [{'clave': k, 'etiqueta': mi.WIDGET_LABELS[k], 'aporta': mi.WIDGET_SPECS[k]['aporta']}
              for k in mi.WIDGET_ORDER if k not in vistos]
    return jsonify({'archivos': salida, 'faltan': faltan, 'casillas': mi.slot_fields()})


@interno_bp.route('/reportes', methods=['POST'])
@herramienta('reports')
def crear_reporte():
    from services import calculation as report
    from services import meltwater_ingest as mi

    demasiado = _comprobar_tamano('reports')
    if demasiado:
        return demasiado

    titulo = (request.form.get('titulo') or '').strip()[:255] or 'Mi Reporte'
    crudo_autores = (request.form.get('autores_unicos') or '').strip().replace('.', '').replace(',', '').replace(' ', '')
    if crudo_autores and not crudo_autores.isdigit():
        return _error(400, 'La cantidad de autores debe ser un número entero.', campo='autores_unicos')
    autores = int(crudo_autores) if crudo_autores else None
    analisis = (request.form.get('analisis_meltwater') or '').strip()
    textos_ia = _bool(request.form.get('textos_ia'), True)
    modo = 'avanzado' if request.form.get('modo') == 'avanzado' else 'simple'

    if modo == 'avanzado':
        subidas = {s['key']: request.files.get(s['field']) for s in mi.slot_fields()}
        subidas = {k: f for k, f in subidas.items() if f and f.filename}
    else:
        subidas = {i: f for i, f in enumerate(request.files.getlist('archivos')) if f and f.filename}
    if not subidas:
        return _error(400, 'Carga al menos un archivo para generar el reporte.')
    for f in subidas.values():
        problema = _validar_archivo('reports', f)
        if problema:
            return _error(400, problema)

    trabajo, error = _nuevo_trabajo('reporte')
    if error:
        return error
    guardados = {k: (f.filename, _guardar_en(trabajo, f)) for k, f in subidas.items()}

    def ejecutar(t):
        total = len(guardados)
        leidos = [0]

        def al_leer(nombre):
            leidos[0] += 1
            t.avisar('carga', (leidos[0] - 1) / total * 100,
                     f'Leyendo «{nombre}» ({leidos[0]} de {total})')

        if modo == 'avanzado':
            slot_files = {}
            for clave, (nombre, ruta) in guardados.items():
                slot_files[clave] = (nombre, _SubidaConAviso(ruta, nombre, al_leer).read())
            widgets, errores, warnings = mi.load_widget_slots(slot_files)
            if errores:
                raise ErrorDeTrabajo(
                    f'Revisa {len(errores)} archivo(s): la estructura no es la esperada.',
                    [f'{mi.WIDGET_LABELS[k]}: {m}' for k, m in errores.items()])
        else:
            archivos = [_SubidaConAviso(ruta, nombre, al_leer) for nombre, ruta in guardados.values()]
            widgets, _detectados, problemas, warnings = mi.load_widget_bulk(archivos)
            if problemas and not widgets:
                raise ErrorDeTrabajo('No se reconoció ninguno de los archivos.', problemas)
            warnings = problemas + warnings
        if not widgets:
            raise ErrorDeTrabajo('Ningún archivo válido: no se puede generar el reporte.')
        t.avisar('carga', 100, f'{len(widgets)} widget(s) reconocidos')

        t.avisar('limpieza', 20, 'Normalizando fechas, sentimiento y redes')
        parsed = mi.parse_widgets(widgets)
        t.avisar('limpieza', 100, 'Datos normalizados')

        contexto = report.create_report_context_from_widgets(
            parsed, report_title=titulo, warnings=warnings, unique_authors=autores,
            meltwater_analysis=analisis, use_ai_insights=False, progreso=t.avisar)

        estado_ia, fuente, error_ia = Report.INSIGHTS_OMITIDO, 'reglas', None
        if textos_ia:
            t.avisar('ia', 40, 'Redactando los textos del reporte')
            # El harness usa el analisis pegado como contexto; la funcion
            # principal lo retira al terminar para no guardarlo.
            contexto['meltwater_analysis'] = analisis
            meta = report.aplicar_insights_de_ia(contexto)
            contexto.pop('meltwater_analysis', None)
            if meta.get('ok'):
                estado_ia, fuente = Report.INSIGHTS_LISTO, 'ia'
                t.avisar('ia', 100, 'Textos redactados por IA')
            else:
                estado_ia, error_ia = Report.INSIGHTS_FALLIDO, meta.get('reason')
                t.avisar('ia', 100, 'Sin IA: se usan los textos por reglas')
        else:
            t.avisar('ia', 100, 'Textos por reglas (IA desactivada)')

        t.avisar('guardado', 30, 'Guardando el reporte')
        guardado = Report(
            token=Report.nuevo_token(),
            title=titulo,
            user_id=t.user_id,
            context_json=json.dumps(contexto, ensure_ascii=False),
            insights_source=fuente,
            insights_status=estado_ia,
            insights_error=error_ia,
        )
        db.session.add(guardado)
        db.session.commit()
        _log('generate_report', f'Reporte: {titulo} ({len(widgets)} widgets)')
        t.avisar('guardado', 100, 'Reporte guardado')
        return {'token': guardado.token, 'titulo': titulo, 'avisos': len(contexto.get('warnings') or []),
                'estado_ia': estado_ia}

    return _lanzar(trabajo, ejecutar)


# ─────────────────────────────────────────────────────────────
# Deteccion de formato (clasificacion, union, analisis)
# ─────────────────────────────────────────────────────────────

def _leer_inicio(archivo, extension):
    """Todo el Excel (no se puede leer a medias); de un CSV, solo el principio."""
    if extension in ('xlsx', 'xls'):
        return archivo.read()
    crudo = archivo.read(BYTES_VISTA_PREVIA)
    # UTF-16 va de dos en dos bytes: cortar en impar rompe el ultimo caracter.
    return crudo[:len(crudo) - (len(crudo) % 2)] if len(crudo) == BYTES_VISTA_PREVIA else crudo


def _detectar(clave):
    from services.file_loader import detect_format, _try_read_csv

    demasiado = _comprobar_tamano(clave)
    if demasiado:
        return demasiado
    archivo = request.files.get('archivo')
    problema = _validar_archivo(clave, archivo)
    if problema:
        return _error(400, problema)
    extension = _extension(archivo.filename)
    crudo = _leer_inicio(archivo, extension)
    resultado = detect_format(crudo, archivo.filename)
    if resultado.get('error'):
        return _error(400, resultado['error'])

    # Forzar codificacion o separador cambia la vista previa. En la pagina
    # Flask el boton "Volver a detectar" mandaba estos campos y la ruta los
    # ignoraba, asi que la vista previa nunca cambiaba.
    codificacion = (request.form.get('codificacion') or '').strip() or None
    separador = (request.form.get('separador') or '').strip() or None
    if separador == '\\t':
        separador = '\t'
    if resultado.get('file_type') == 'csv' and (codificacion or separador):
        enc = codificacion or resultado['encoding']
        sep = separador or resultado['sep']
        df = _try_read_csv(crudo, enc, sep)
        if df is None:
            return _error(400, 'Con esa codificación y ese separador el archivo no se lee bien.')
        resultado.update(encoding=enc, sep=sep,
                         columns=[str(c) for c in df.columns.tolist()],
                         preview=df.head(5).fillna('').astype(str).to_dict(orient='records'))

    return jsonify({
        'columnas': resultado['columns'],
        'vista_previa': resultado['preview'],
        'codificacion': resultado.get('encoding'),
        'separador': resultado.get('sep'),
        'tipo': resultado.get('file_type'),
    })


@interno_bp.route('/clasificacion/detectar', methods=['POST'])
@herramienta('classification')
def detectar_clasificacion():
    return _detectar('classification')


@interno_bp.route('/union/detectar', methods=['POST'])
@herramienta('file_merge')
def detectar_union():
    return _detectar('file_merge')


@interno_bp.route('/analisis/detectar', methods=['POST'])
@herramienta('csv_analysis')
def detectar_analisis():
    return _detectar('csv_analysis')


def _formato(ruta, nombre, codificacion=None, separador=None):
    """Formato completo de un archivo ya guardado, con lo que el usuario forzo encima."""
    from services.file_loader import detect_format

    with open(ruta, 'rb') as f:
        crudo = f.read() if _extension(nombre) in ('xlsx', 'xls') else f.read(BYTES_VISTA_PREVIA)
    if _extension(nombre) not in ('xlsx', 'xls') and len(crudo) == BYTES_VISTA_PREVIA:
        crudo = crudo[:len(crudo) - (len(crudo) % 2)]
    fmt = detect_format(crudo, nombre)
    if fmt.get('error') and not (codificacion and separador):
        raise ErrorDeTrabajo(fmt['error'])
    if fmt.get('error'):
        fmt = {'file_type': 'csv'}
    if codificacion:
        fmt['encoding'] = codificacion
    if separador:
        fmt['sep'] = '\t' if separador == '\\t' else separador
    return fmt


# ─────────────────────────────────────────────────────────────
# Clasificacion
# ─────────────────────────────────────────────────────────────

def _estadisticas_clasificacion(df):
    stats = {}
    if df is None or df.empty or 'Categoria' not in df.columns or 'Tematica' not in df.columns:
        return stats
    agrupado = df.groupby(['Categoria', 'Tematica']).size().reset_index(name='count')
    for _, fila in agrupado.iterrows():
        cat, tem, n = str(fila['Categoria']), str(fila['Tematica']), int(fila['count'])
        stats.setdefault(cat, {'total': 0, 'tematicas': {}})
        stats[cat]['total'] += n
        stats[cat]['tematicas'][tem] = stats[cat]['tematicas'].get(tem, 0) + n
    return stats


def _sumar_stats(destino, parcial):
    for cat, datos in parcial.items():
        d = destino.setdefault(cat, {'total': 0, 'tematicas': {}})
        d['total'] += datos['total']
        for tem, n in datos['tematicas'].items():
            d['tematicas'][tem] = d['tematicas'].get(tem, 0) + n


def _reglas_validas(crudo):
    try:
        reglas = json.loads(crudo or '[]')
    except (TypeError, ValueError):
        return None
    if not isinstance(reglas, list):
        return None
    limpias = []
    for cat in reglas:
        if not isinstance(cat, dict):
            return None
        tematicas = []
        for tem in cat.get('tematicas') or []:
            if not isinstance(tem, dict):
                return None
            palabras = tem.get('keywords') or []
            if isinstance(palabras, str):
                palabras = palabras.split(',')
            palabras = [str(p).strip() for p in palabras if str(p).strip()]
            tematicas.append({'name': str(tem.get('name') or 'General')[:200], 'keywords': palabras})
        limpias.append({'category': str(cat.get('category') or 'Otros')[:200], 'tematicas': tematicas})
    return limpias


@interno_bp.route('/clasificacion', methods=['POST'])
@herramienta('classification')
def clasificar():
    from services.classifier import classify_chunk
    from services.file_merger import read_file

    demasiado = _comprobar_tamano('classification')
    if demasiado:
        return demasiado
    archivo = request.files.get('archivo')
    problema = _validar_archivo('classification', archivo)
    if problema:
        return _error(400, problema)
    reglas = _reglas_validas(request.form.get('reglas'))
    if reglas is None:
        return _error(400, 'Las reglas de clasificación no tienen un formato válido.')
    if not any(t['keywords'] for c in reglas for t in c['tematicas']):
        return _error(400, 'Añade al menos una temática con palabras clave.')
    defecto = (request.form.get('etiqueta_defecto') or '').strip()[:100] or 'Sin Clasificar'
    usar_keywords = _bool(request.form.get('usar_keywords'))
    col_texto = (request.form.get('columna_texto') or '').strip() or 'Hit Sentence'
    col_keywords = (request.form.get('columna_keywords') or '').strip()
    codificacion = (request.form.get('codificacion') or '').strip() or None
    separador = (request.form.get('separador') or '').strip() or None

    trabajo, error = _nuevo_trabajo('clasificacion')
    if error:
        return error
    nombre = archivo.filename
    ruta = _guardar_en(trabajo, archivo)

    def ejecutar(t):
        t.avisar('carga', 20, 'Detectando codificación y separador')
        fmt = _formato(ruta, nombre, codificacion, separador)
        t.avisar('carga', 60, f'Leyendo el archivo ({fmt.get("encoding") or fmt.get("file_type")})')
        with open(ruta, 'rb') as f:
            crudo = f.read()
        try:
            df = read_file(crudo, nombre, encoding=fmt.get('encoding'), sep=fmt.get('sep'))
        except ValueError as e:
            raise ErrorDeTrabajo(str(e))
        del crudo
        t.avisar('carga', 100, f'{len(df):,} filas leídas')

        t.avisar('limpieza', 30, 'Comprobando las columnas elegidas')
        columnas = [str(c) for c in df.columns]
        # Una columna elegida que no existe es un error, no una invitacion a
        # clasificar en silencio con otra. Solo el valor por defecto puede
        # caer en Headline, como hace el clasificador.
        if col_texto not in columnas and not (col_texto == 'Hit Sentence' and 'Headline' in columnas):
            raise ErrorDeTrabajo(f'La columna de texto «{col_texto}» no está en el archivo.',
                                 [f'Columnas disponibles: {", ".join(columnas[:30])}'])
        if usar_keywords and col_keywords and col_keywords not in columnas:
            raise ErrorDeTrabajo(f'La columna de palabras clave «{col_keywords}» no está en el archivo.')
        # Cabecera una vez, y cada lote como texto TSV con sus comillas: los
        # textos con saltos de linea viajan enteros, no partidos entre lotes.
        cabecera = df.head(0).to_csv(sep='\t', index=False)
        t.avisar('limpieza', 100, 'Columnas listas')

        salida_nombre = f'classified_{t.id}.csv'
        salida = _ruta_scratch(salida_nombre)
        stats = {}
        total = len(df)
        lotes = max(1, -(-total // FILAS_POR_LOTE))
        filas_clasificadas = 0
        escrito = False
        for i in range(lotes):
            t.avisar('calculo', i / lotes * 100, f'Lote {i + 1} de {lotes} · {min(total, (i + 1) * FILAS_POR_LOTE):,} de {total:,} filas')
            trozo = df.iloc[i * FILAS_POR_LOTE:(i + 1) * FILAS_POR_LOTE]
            texto = trozo.to_csv(sep='\t', index=False, header=False)
            if not texto.strip():
                continue
            parcial = classify_chunk(texto, cabecera, reglas, default_val=defecto,
                                     use_keywords=usar_keywords, text_col=col_texto,
                                     keywords_col=col_keywords)
            if parcial is None or parcial.empty:
                continue
            parcial.to_csv(salida, sep='\t', encoding='utf-16', index=False,
                           mode='a' if escrito else 'w', header=not escrito)
            escrito = True
            filas_clasificadas += len(parcial)
            _sumar_stats(stats, _estadisticas_clasificacion(parcial))
        if not escrito:
            raise ErrorDeTrabajo('El archivo no tiene filas que clasificar.')
        t.avisar('calculo', 100, f'{filas_clasificadas:,} filas clasificadas')

        t.avisar('graficos', 50, 'Resumiendo categorías y temáticas')
        top, top_n = 'N/A', -1
        for cat, d in stats.items():
            if cat != defecto and d['total'] > top_n:
                top, top_n = cat, d['total']
        sin = (stats.get(defecto) or {}).get('total', 0)

        t.avisar('guardado', 50, 'Preparando la descarga')
        _registrar_artefacto('classified', t.id, salida_nombre)
        _log('classify_data', f'Clasificacion: {secure_filename(nombre)} ({filas_clasificadas} filas, {len(stats)} categorias)')
        base = os.path.splitext(secure_filename(nombre) or 'archivo')[0]
        return {
            'descarga': {'tipo': 'classified', 'id': t.id, 'nombre': f'Clasificado_{base}.csv'},
            'stats': stats,
            'total_filas': filas_clasificadas,
            'clasificadas': filas_clasificadas - sin,
            'sin_clasificar': sin,
            'etiqueta_defecto': defecto,
            'insights': {'top_category': top, 'top_count': max(top_n, 0)},
        }

    return _lanzar(trabajo, ejecutar)


# ─────────────────────────────────────────────────────────────
# Union de archivos
# ─────────────────────────────────────────────────────────────

def _lista_json(crudo):
    try:
        valor = json.loads(crudo or '[]')
    except (TypeError, ValueError):
        return []
    return valor if isinstance(valor, list) else []


@interno_bp.route('/union', methods=['POST'])
@herramienta('file_merge')
def unir():
    from services.file_merger import read_file, merge_default, merge_advanced, save_merged

    demasiado = _comprobar_tamano('file_merge')
    if demasiado:
        return demasiado
    modo = 'avanzado' if request.form.get('modo') == 'avanzado' else 'predeterminado'

    if modo == 'avanzado':
        archivos = [request.files.get('archivo_a'), request.files.get('archivo_b')]
        if not all(a and a.filename for a in archivos):
            return _error(400, 'Se necesitan los dos archivos para el modo avanzado.')
        try:
            mapeo = json.loads(request.form.get('mapeo') or '{}')
        except ValueError:
            return _error(400, 'Mapeo de columnas inválido.')
        if not isinstance(mapeo, dict) or not mapeo:
            return _error(400, 'Elige al menos una columna del archivo B para unir.')
        codificaciones = [request.form.get('codificacion_a') or None, request.form.get('codificacion_b') or None]
        separadores = [request.form.get('separador_a') or None, request.form.get('separador_b') or None]
        extras = [e for e in _lista_json(request.form.get('columnas_extra'))
                  if isinstance(e, dict) and str(e.get('name') or '').strip()]
    else:
        archivos = [a for a in request.files.getlist('archivos') if a and a.filename]
        if len(archivos) < 2:
            return _error(400, 'Se necesitan al menos 2 archivos.')
        codificaciones = _lista_json(request.form.get('codificaciones'))
        separadores = _lista_json(request.form.get('separadores'))
        mapeo, extras = None, []
    for a in archivos:
        problema = _validar_archivo('file_merge', a)
        if problema:
            return _error(400, problema)

    trabajo, error = _nuevo_trabajo('union')
    if error:
        return error
    guardados = [(a.filename, _guardar_en(trabajo, a)) for a in archivos]

    def ejecutar(t):
        tablas = []
        total = len(guardados)
        for i, (nombre, ruta) in enumerate(guardados):
            t.avisar('carga', i / total * 100, f'Leyendo «{nombre}» ({i + 1} de {total})')
            enc = codificaciones[i] if i < len(codificaciones) and codificaciones[i] else None
            sep = separadores[i] if i < len(separadores) and separadores[i] else None
            if sep == '\\t':
                sep = '\t'
            with open(ruta, 'rb') as f:
                crudo = f.read()
            try:
                tablas.append(read_file(crudo, nombre, encoding=enc, sep=sep))
            except ValueError as e:
                raise ErrorDeTrabajo(f'«{nombre}»: {e}')
        t.avisar('carga', 100, f'{total} archivos leídos')

        t.avisar('limpieza', 50, 'Alineando columnas por nombre')
        t.avisar('calculo', 20, 'Uniendo filas')
        try:
            if modo == 'avanzado':
                unido = merge_advanced(tablas[0], tablas[1], mapeo)
                for e in extras:
                    unido[str(e['name']).strip()] = e.get('value', '')
                detalle = f'Union avanzada: {guardados[0][0]} + {guardados[1][0]} ({len(unido)} filas)'
            else:
                unido = merge_default(tablas)
                detalle = f'Union predeterminada: {", ".join(n for n, _ in guardados)} ({len(unido)} filas)'
        except ValueError as e:
            raise ErrorDeTrabajo(str(e))
        t.avisar('calculo', 100, f'{len(unido):,} filas unidas')

        t.avisar('guardado', 20, 'Escribiendo el archivo unido')
        salida_nombre = f'merged_{t.id}.csv'
        save_merged(unido, _ruta_scratch(salida_nombre))
        _registrar_artefacto('union', t.id, salida_nombre)
        _log('file_merge', detalle)
        return {
            'descarga': {'tipo': 'union', 'id': t.id, 'nombre': f'Union_{time.strftime("%Y%m%d_%H%M")}.csv'},
            'total_filas': len(unido),
            'total_columnas': len(unido.columns),
            'archivos_unidos': total,
            'columnas': [str(c) for c in unido.columns][:200],
            'filas_por_archivo': [{'nombre': n, 'filas': len(tb)} for (n, _), tb in zip(guardados, tablas)],
        }

    return _lanzar(trabajo, ejecutar)


# ─────────────────────────────────────────────────────────────
# Analisis rapido de CSV
# ─────────────────────────────────────────────────────────────

@interno_bp.route('/analisis', methods=['POST'])
@herramienta('csv_analysis')
def analizar():
    from services.csv_analysis import analyze_csv, generate_summary_csv

    demasiado = _comprobar_tamano('csv_analysis')
    if demasiado:
        return demasiado
    archivo = request.files.get('archivo')
    problema = _validar_archivo('csv_analysis', archivo)
    if problema:
        return _error(400, problema)
    codificacion = (request.form.get('codificacion') or '').strip() or None
    separador = (request.form.get('separador') or '').strip() or None

    trabajo, error = _nuevo_trabajo('analisis')
    if error:
        return error
    nombre = archivo.filename
    ruta = _guardar_en(trabajo, archivo)

    def ejecutar(t):
        t.avisar('carga', 30, 'Detectando codificación y separador')
        fmt = _formato(ruta, nombre, codificacion, separador)
        enc, sep = fmt.get('encoding') or 'utf-8', fmt.get('sep') or ','
        t.avisar('carga', 100, f'Codificación {enc} · separador {"tabulador" if sep == chr(9) else sep}')

        resultado = analyze_csv(ruta, enc, sep, progreso=t.avisar)
        if not resultado.get('success'):
            raise ErrorDeTrabajo('No se pudo analizar el archivo con ese formato.',
                                 [str(resultado.get('error') or '')[:300]])

        t.avisar('guardado', 40, 'Preparando el resumen descargable')
        resumen = f'summary_{t.id}.csv'
        generate_summary_csv(resultado, _ruta_scratch(resumen))
        _registrar_artefacto('csv_summary', t.id, resumen)
        _log('csv_analysis', f'Análisis CSV: {secure_filename(nombre)}')
        resultado['nombre_original'] = nombre
        resultado['descarga'] = {'tipo': 'csv_summary', 'id': t.id,
                                 'nombre': f'analisis_{os.path.splitext(secure_filename(nombre) or "archivo")[0]}.csv'}
        return resultado

    return _lanzar(trabajo, ejecutar)


# ─────────────────────────────────────────────────────────────
# Descargas
# ─────────────────────────────────────────────────────────────

_DESCARGAS = {
    'classified': 'classification',
    'union': 'file_merge',
    'csv_summary': 'csv_analysis',
}


@interno_bp.route('/descargas/<kind>/<file_id>')
def descargar(kind, file_id):
    if kind not in _DESCARGAS:
        return _error(404, 'Descarga no encontrada.')
    if not current_user.has_tool_access(_DESCARGAS[kind]):
        return _error(403, 'No tienes acceso a esta herramienta.')
    seguro = secure_filename(file_id)
    artefacto = TempArtifact.query.filter_by(kind=kind, file_id=seguro).first()
    # Lo de otro no se distingue de lo que no existe.
    if artefacto is None or (artefacto.user_id != current_user.id and not current_user.is_admin):
        return _error(404, 'El archivo ya no está disponible. Vuelve a procesarlo.')
    ruta = _ruta_scratch(artefacto.storage_name)
    raiz = os.path.abspath(current_app.config.get('UPLOAD_FOLDER', 'scratch'))
    if not os.path.abspath(ruta).startswith(raiz + os.sep) or not os.path.exists(ruta):
        return _error(404, 'El archivo ya no está disponible. Vuelve a procesarlo.')
    nombre = secure_filename(request.args.get('nombre') or '') or f'{kind}_{seguro}.csv'
    return send_file(ruta, as_attachment=True, download_name=nombre, mimetype='text/csv')


def preparar(app):
    """Exenciones que no se pueden declarar desde el propio blueprint."""
    from extensions import csrf, limiter
    csrf.exempt(interno_bp)
    limiter.exempt(interno_bp)
    # Entre servicios la llamada va por HTTP en la red interna: forzar HTTPS
    # aqui convertiria cada peticion en una redireccion que nadie sigue.
    for nombre, vista in app.view_functions.items():
        if nombre.startswith('interno.'):
            opciones = dict(getattr(vista, 'talisman_view_options', {}) or {})
            opciones['force_https'] = False
            vista.talisman_view_options = opciones
