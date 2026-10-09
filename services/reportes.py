"""
services/reportes.py
--------------------
Lo que se hace con un reporte guardado, sin Flask de por medio.

Vivia dentro de las rutas de app.py. Ahora lo usan dos puertas: las paginas
Flask de siempre y la API interna que llama la app Next.js. Tenerlo en un solo
sitio es lo que garantiza que las dos aplican las mismas reglas: quien edita,
que campos se aceptan y cuando se vuelve a pagar al modelo.
"""
import json

from extensions import db
from models import Report


def slots_de_insights():
    from services.insight_harness import SLOTS
    return list(SLOTS)


def puede_editar(guardado, usuario):
    """Leer exige el enlace y el modulo; editar, ser el dueno (o admin)."""
    return guardado.user_id == usuario.id or usuario.is_admin


def vista_de_reporte(contexto):
    """Los calculos que la plantilla no debe hacer.

    Viven aqui y no en la vista para que nadie tenga que hacer aritmetica ni
    protegerse de la division por cero al pintar.
    """
    total = contexto['kpis']['total_mentions'] or 1
    return {
        'pct_redes': round(contexto['kpis']['mentions_redes'] / total * 100),
        'pct_prensa': round(contexto['kpis']['mentions_prensa'] / total * 100),
        'top_authors': sorted(
            contexto['content'].get('top_authors', []),
            key=lambda a: a['posts'], reverse=True
        )[:8],
    }


def guardar_retoques(guardado, entrantes):
    """Guarda los retoques del analista aparte del contexto.

    Devuelve cuantos retoques tiene el reporte, o None si no habia nada que
    guardar. Solo se aceptan los campos conocidos: el cuerpo lo escribe el
    navegador y no puede sembrar claves arbitrarias.
    """
    if not isinstance(entrantes, dict):
        return None

    permitidos = set(slots_de_insights()) | {'client_name'}
    retoques = json.loads(guardado.edits_json) if guardado.edits_json else {}
    for slot, texto in entrantes.items():
        if slot in permitidos and isinstance(texto, str):
            # Un limite generoso: corta un pegado accidental de un documento
            # entero sin estorbar a nadie que escriba de verdad.
            retoques[slot] = texto.strip()[:2000]

    guardado.edits_json = json.dumps(retoques, ensure_ascii=False)
    if 'client_name' in retoques and retoques['client_name']:
        guardado.title = retoques['client_name'][:255]
    db.session.commit()
    return len(retoques)


def pedir_insights(guardado):
    """Pide los textos al modelo y los guarda en el reporte.

    Devuelve un dict con success, estado, source, insights, warnings y error.
    Si ya estaban listos no se repite el gasto: recargar no paga dos veces.
    Lo que el analista retoco a mano manda sobre lo que traiga el modelo.
    """
    from services import calculation as report

    if guardado.insights_status == Report.INSIGHTS_LISTO:
        datos = json.loads(guardado.context_json or '{}')
        return {'success': True, 'estado': guardado.insights_status,
                'source': guardado.insights_source,
                'insights': datos.get('insights') or {},
                'warnings': datos.get('warnings') or [],
                'error': None}

    contexto = json.loads(guardado.context_json or '{}')
    if not contexto:
        return None

    meta = report.aplicar_insights_de_ia(contexto)
    aplicar_resultado_de_ia(guardado, meta)
    guardado.context_json = json.dumps(contexto, ensure_ascii=False)
    db.session.commit()

    editados = guardado.slots_editados()
    insights = {k: v for k, v in (contexto.get('insights') or {}).items() if k not in editados}
    return {
        'success': bool(meta.get('ok')),
        'estado': guardado.insights_status,
        'source': guardado.insights_source,
        'insights': insights,
        'warnings': contexto.get('warnings') or [],
        'error': guardado.insights_error,
    }


def aplicar_resultado_de_ia(guardado, meta):
    """Anota en la fila como fue la llamada al modelo.

    Que el modelo falle no invalida el reporte: se queda con el texto por
    reglas, que ya estaba escrito, y se recuerda el motivo para poder
    ensenarlo en vez de dejar la pagina girando para siempre.
    """
    if meta.get('ok'):
        guardado.insights_status = Report.INSIGHTS_LISTO
        guardado.insights_source = 'ia'
        guardado.insights_error = None
    else:
        guardado.insights_status = Report.INSIGHTS_FALLIDO
        guardado.insights_error = meta.get('reason')
