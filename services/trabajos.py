"""
services/trabajos.py
--------------------
Trabajos largos (generar un reporte, clasificar, unir, analizar) fuera de la
peticion que los pide.

Antes cada herramienta trabajaba dentro de la peticion: el navegador esperaba
sin saber nada y Gunicorn cortaba a los 180 s. Ahora la peticion deja el
trabajo en una cola, devuelve su id y se va; quien lo pidio pregunta por el
estado (fase, porcentaje, mensaje) hasta que termina.

El estado vive en memoria del proceso y, ademas, en un `estado.json` dentro de
la carpeta del trabajo en scratch/. La copia en disco es la que permite que un
segundo worker de Gunicorn conteste por un trabajo que no lanzo el, y que una
cancelacion pedida a otro worker llegue (un fichero `cancelar` en la misma
carpeta). Sin dependencias nuevas: un ThreadPoolExecutor y el disco que ya
usa la app.

Cada fase avisa con su porcentaje *dentro* de la fase. Nada de barras que
avanzan solas: si el codigo no sabe cuanto falta, no se inventa.
"""
import json
import logging
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Cuanto se recuerda un trabajo terminado. Pasado ese tiempo su carpeta la
# barre la limpieza de scratch/ (que borra lo que tiene mas de una hora).
RETENCION_S = 3600

EN_COLA = 'en_cola'
EN_CURSO = 'en_curso'
HECHO = 'hecho'
FALLIDO = 'fallido'
CANCELADO = 'cancelado'
TERMINALES = {HECHO, FALLIDO, CANCELADO}


class Cancelado(Exception):
    """Quien lo pidio cancelo el trabajo: se para en el siguiente punto seguro."""


class ErrorDeTrabajo(Exception):
    """Un fallo que se explica al usuario tal cual (archivo invalido, columnas...)."""

    def __init__(self, mensaje, detalle=None):
        super().__init__(mensaje)
        self.detalle = list(detalle or [])


class Trabajo:
    def __init__(self, registro, tipo, user_id):
        self.registro = registro
        self.id = uuid.uuid4().hex
        self.tipo = tipo
        self.user_id = user_id
        self.estado = EN_COLA
        self.fase = 'cola'
        self.progreso = None
        self.mensaje = 'En cola'
        self.error = None
        self.detalle = []
        self.resultado = None
        self.creado = time.time()
        self.actualizado = self.creado
        self.terminado = None
        self._cancelar = threading.Event()
        self.futuro = None
        self.carpeta = os.path.join(registro.raiz, f'trabajo_{self.id}')
        self.entrada = os.path.join(self.carpeta, 'entrada')
        os.makedirs(self.entrada, exist_ok=True)

    # ── Lo que llama la funcion del trabajo ─────────────────────────────

    def comprobar(self):
        """Punto seguro: si se pidio cancelar, se para aqui."""
        if self._cancelar.is_set() or os.path.exists(os.path.join(self.carpeta, 'cancelar')):
            raise Cancelado()

    def avisar(self, fase, progreso=None, mensaje=None):
        """Fase actual, porcentaje dentro de la fase (0-100 o None) y mensaje."""
        self.comprobar()
        self.fase = fase
        self.progreso = None if progreso is None else max(0, min(100, round(float(progreso), 1)))
        if mensaje is not None:
            self.mensaje = mensaje
        self.actualizado = time.time()
        self.guardar()

    # ── Estado ──────────────────────────────────────────────────────────

    def publico(self):
        return {
            'id': self.id,
            'tipo': self.tipo,
            'estado': self.estado,
            'fase': self.fase,
            'progreso': self.progreso,
            'mensaje': self.mensaje,
            'error': self.error,
            'detalle': self.detalle,
            'resultado': self.resultado,
            'creado': self.creado,
            'actualizado': self.actualizado,
        }

    def guardar(self):
        datos = dict(self.publico(), user_id=self.user_id)
        try:
            os.makedirs(self.carpeta, exist_ok=True)
            tmp = os.path.join(self.carpeta, 'estado.json.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(datos, f, ensure_ascii=False, default=str)
            os.replace(tmp, os.path.join(self.carpeta, 'estado.json'))
        except OSError as e:
            # El estado en memoria sigue valiendo; solo se pierde la copia
            # para otros workers.
            logger.warning('No se pudo guardar el estado del trabajo %s: %s', self.id, e)

    def limpiar_entrada(self):
        shutil.rmtree(self.entrada, ignore_errors=True)


class Registro:
    def __init__(self, raiz, max_workers=2, max_por_usuario=3):
        self.raiz = raiz
        self.max_por_usuario = max_por_usuario
        self._trabajos = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix='trabajo')
        os.makedirs(raiz, exist_ok=True)

    # ── Alta ────────────────────────────────────────────────────────────

    def activos_de(self, user_id):
        with self._lock:
            return [t for t in self._trabajos.values()
                    if t.user_id == user_id and t.estado not in TERMINALES]

    def crear(self, tipo, user_id):
        self.purgar()
        trabajo = Trabajo(self, tipo, user_id)
        with self._lock:
            self._trabajos[trabajo.id] = trabajo
        trabajo.guardar()
        return trabajo

    def lanzar(self, trabajo, funcion, app, sincrono=False):
        """Pone el trabajo en la cola. `funcion(trabajo)` devuelve el resultado.

        Corre dentro de un contexto de aplicacion y de peticion con el usuario
        cargado como current_user: asi los servicios que ya existian (registro
        de actividad, consumo de IA) atribuyen el trabajo a quien lo pidio sin
        tener que cambiarlos.
        """
        if sincrono:
            self._ejecutar(trabajo, funcion, app)
            return trabajo
        trabajo.futuro = self._pool.submit(self._ejecutar, trabajo, funcion, app)
        return trabajo

    def _ejecutar(self, trabajo, funcion, app):
        from flask import g
        from extensions import db
        from models import User

        with app.app_context(), app.test_request_context('/api/interno/trabajos'):
            try:
                g._login_user = db.session.get(User, trabajo.user_id)
                trabajo.comprobar()
                trabajo.estado = EN_CURSO
                trabajo.avisar('carga', 0, 'Empezando')
                resultado = funcion(trabajo)
                trabajo.comprobar()
                trabajo.resultado = resultado
                trabajo.estado = HECHO
                trabajo.fase = 'hecho'
                trabajo.progreso = 100
                trabajo.mensaje = 'Listo'
            except Cancelado:
                trabajo.estado = CANCELADO
                trabajo.mensaje = 'Cancelado'
                trabajo.error = None
            except ErrorDeTrabajo as e:
                trabajo.estado = FALLIDO
                trabajo.error = str(e)
                trabajo.detalle = e.detalle
            except Exception:
                logger.exception('El trabajo %s (%s) fallo', trabajo.id, trabajo.tipo)
                trabajo.estado = FALLIDO
                trabajo.error = 'Error inesperado procesando los archivos. Intenta de nuevo.'
            finally:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                db.session.remove()
                trabajo.terminado = time.time()
                trabajo.actualizado = trabajo.terminado
                trabajo.limpiar_entrada()
                trabajo.guardar()

    # ── Consulta y cancelacion ──────────────────────────────────────────

    def obtener(self, trabajo_id):
        """El estado publico del trabajo con su dueno, o None.

        Primero memoria; si este worker no lo conoce, la copia en disco.
        """
        if not trabajo_id or not all(c in '0123456789abcdef' for c in trabajo_id):
            return None
        with self._lock:
            trabajo = self._trabajos.get(trabajo_id)
        if trabajo is not None:
            return dict(trabajo.publico(), user_id=trabajo.user_id)
        ruta = os.path.join(self.raiz, f'trabajo_{trabajo_id}', 'estado.json')
        try:
            with open(ruta, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def cancelar(self, trabajo_id):
        with self._lock:
            trabajo = self._trabajos.get(trabajo_id)
        if trabajo is not None:
            if trabajo.estado in TERMINALES:
                return False
            trabajo._cancelar.set()
            # Si aun no habia empezado, no llega a empezar.
            if trabajo.futuro is not None and trabajo.futuro.cancel():
                trabajo.estado = CANCELADO
                trabajo.mensaje = 'Cancelado'
                trabajo.terminado = time.time()
                trabajo.limpiar_entrada()
                trabajo.guardar()
            return True
        # Lo lanzo otro worker: se le deja la senal en su carpeta.
        carpeta = os.path.join(self.raiz, f'trabajo_{trabajo_id}')
        if not os.path.isdir(carpeta):
            return False
        with open(os.path.join(carpeta, 'cancelar'), 'w') as f:
            f.write('1')
        return True

    def en_cola_delante(self, trabajo):
        with self._lock:
            return sum(1 for t in self._trabajos.values()
                       if t.estado == EN_COLA and t.creado < trabajo.creado)

    def purgar(self, ahora=None):
        """Olvida los trabajos terminados hace mas de RETENCION_S."""
        ahora = ahora or time.time()
        with self._lock:
            viejos = [i for i, t in self._trabajos.items()
                      if t.terminado and ahora - t.terminado > RETENCION_S]
            for i in viejos:
                t = self._trabajos.pop(i)
                shutil.rmtree(t.carpeta, ignore_errors=True)
