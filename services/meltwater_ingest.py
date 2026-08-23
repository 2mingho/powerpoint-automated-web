"""
services/meltwater_ingest.py
-----------------------------
Ingests the "widget" .xlsx exports Meltwater still allows downloading
(Mentions Trend, Reach Trend, Sentiment, etc.) now that the row-level
mentions export is no longer available.

Each widget is identified by its sheet name (stable across re-downloads,
unlike the filename the user gives it), parsed into a small, JSON-ready
structure, and returned in a dict keyed by widget type. Missing or
unrecognized files never raise — they're reported back as warnings so the
report can still be built with whatever widgets are present.
"""
import io
import math
import pandas as pd

from services import translations


# sheet name (lowercased, stripped) -> internal widget key
SHEET_TYPE_MAP = {
    'mentions trend': 'mentions_trend',
    'reach trend': 'reach_trend',
    'ai-powered clusters': 'clusters',
    'top keywords and entities': 'keywords',
    'sentiment': 'sentiment',
    'mentions trend by source type': 'mentions_by_source',
    'sentiment by source type': 'sentiment_by_source',
    'top hashtags': 'hashtags',
    'emotional comparison': 'emotions',
    'top x authors': 'top_authors',
}

# Nombre en español de cada widget: es lo que ve el usuario en las casillas y en
# los avisos. El nombre inglés de la hoja no se toca — ese es el identificador
# real dentro del .xlsx y se muestra aparte para poder cotejarlo.
WIDGET_LABELS = {
    'mentions_trend': 'Evolución y cantidad de menciones',
    'reach_trend': 'Alcance',
    'clusters': 'Temas detectados por IA',
    'keywords': 'Palabras clave y entidades',
    'sentiment': 'Sentimiento',
    'mentions_by_source': 'Menciones por red',
    'sentiment_by_source': 'Sentimiento por red',
    'hashtags': 'Hashtags más usados',
    'emotions': 'Emociones',
    'top_authors': 'Autores destacados en X',
}

# Qué debe contener cada casilla de carga. `sheet` es el nombre de la hoja que
# pone Meltwater al exportar el widget — es el identificador fiable, porque el
# nombre del archivo lo cambia cualquiera. `min_cols` y `columns` detectan un
# export recortado o con la estructura cambiada antes de que reviente el parser.
WIDGET_ORDER = [
    'mentions_trend', 'reach_trend', 'sentiment', 'mentions_by_source',
    'sentiment_by_source', 'emotions', 'clusters', 'keywords',
    'hashtags', 'top_authors',
]

WIDGET_SPECS = {
    'mentions_trend': {
        'sheet': 'Mentions Trend', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Menciones por día, con el periodo anterior.',
        'aporta': 'Menciones totales y su variación · gráfico de evolución',
    },
    'reach_trend': {
        'sheet': 'Reach Trend', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Alcance por día, con el periodo anterior.',
        'aporta': 'Alcance estimado y su variación',
    },
    'sentiment': {
        'sheet': 'Sentiment', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Distribución de sentimiento.',
        'aporta': 'Gráfico de sentimiento',
    },
    'mentions_by_source': {
        'sheet': 'Mentions Trend by Source Type', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Menciones por día desglosadas por red.',
        'aporta': 'Reparto prensa/redes · menciones por red',
    },
    'sentiment_by_source': {
        'sheet': 'Sentiment By Source Type', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Sentimiento cruzado por red.',
        'aporta': 'Gráfico de sentimiento por red',
    },
    'emotions': {
        'sheet': 'Emotional Comparison', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Emociones dominantes.',
        'aporta': 'Gráfico de emociones',
    },
    'clusters': {
        'sheet': 'AI-Powered Clusters', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Temas detectados por la IA de Meltwater.',
        'aporta': 'Tabla de temas principales',
    },
    'keywords': {
        'sheet': 'Top Keywords and Entities', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Palabras clave y entidades más mencionadas.',
        'aporta': 'Gráfico de palabras clave',
    },
    'hashtags': {
        'sheet': 'Top Hashtags', 'min_cols': 2, 'min_rows': 1,
        'hint': 'Hashtags más usados.',
        'aporta': 'Gráfico de hashtags',
    },
    'top_authors': {
        'sheet': 'Top X Authors', 'min_cols': 2, 'min_rows': 1,
        'columns': ['Authors', 'Posts'],
        'hint': 'Autores destacados con publicaciones y seguidores.',
        'aporta': 'Tabla de autores más activos',
    },
}


def slot_fields():
    """Descripción de cada casilla, para pintar el formulario de carga."""
    return [
        {
            'key': key,
            'field': f'widget_{key}',
            'label': WIDGET_LABELS[key],
            'sheet': WIDGET_SPECS[key]['sheet'],
            'hint': WIDGET_SPECS[key]['hint'],
            'aporta': WIDGET_SPECS[key]['aporta'],
        }
        for key in WIDGET_ORDER
    ]


def _describe_mismatch(expected_key, sheet_name):
    """Si el archivo es otro widget conocido, decirlo por su nombre."""
    otro = SHEET_TYPE_MAP.get((sheet_name or '').strip().lower())
    esperado = WIDGET_LABELS[expected_key]
    if otro and otro != expected_key:
        return (f"Este archivo es «{WIDGET_LABELS[otro]}», no «{esperado}». "
                f"Parece que se cargó en la casilla equivocada.")
    return (f"No parece el export de «{esperado}»: se esperaba una hoja "
            f"llamada «{WIDGET_SPECS[expected_key]['sheet']}» y trae «{sheet_name}».")


def validate_widget(key, raw_bytes, filename=''):
    """
    Comprueba que *raw_bytes* es el widget de Meltwater que espera la casilla.

    Devuelve (df, error). `df` es None cuando hay error, y `error` es un texto
    en español que explica qué pasa y cómo arreglarlo.
    """
    spec = WIDGET_SPECS[key]

    try:
        xl = pd.ExcelFile(io.BytesIO(raw_bytes))
    except Exception:
        return None, (f"«{filename}» no se pudo abrir como Excel. "
                      f"Descárgalo de nuevo desde Meltwater en formato .xlsx.")

    if not xl.sheet_names:
        return None, f"«{filename}» no contiene ninguna hoja de datos."

    sheet_name = xl.sheet_names[0]
    if sheet_name.strip().lower() != spec['sheet'].strip().lower():
        return None, _describe_mismatch(key, sheet_name)

    try:
        df = xl.parse(sheet_name)
    except Exception:
        return None, f"La hoja «{sheet_name}» de «{filename}» no se pudo leer."

    if df.empty or len(df) < spec.get('min_rows', 1):
        return None, (f"«{filename}» tiene la estructura correcta pero está vacío. "
                      f"Comprueba el rango de fechas en Meltwater.")

    if len(df.columns) < spec.get('min_cols', 2):
        return None, (f"«{filename}» trae {len(df.columns)} columna(s) y se esperaban "
                      f"al menos {spec['min_cols']}. Puede ser un export incompleto.")

    faltantes = [c for c in spec.get('columns', []) if c not in df.columns]
    if faltantes:
        return None, (f"A «{filename}» le faltan columnas: {', '.join(faltantes)}. "
                      f"Exporta el widget completo desde Meltwater.")

    return df, None


def load_widget_slots(slot_files):
    """
    Carga los widgets desde casillas nombradas, una por tipo.

    Frente a adivinar el tipo de un montón de archivos, aquí el usuario dice qué
    es cada uno y la app solo verifica: si no cuadra, el mensaje puede señalar el
    archivo concreto y la casilla concreta.

    Parameters
    ----------
    slot_files : dict[str, (filename, bytes)] — clave = tipo de widget.

    Returns
    -------
    (widgets, errors, warnings)
        errors   : dict[widget_key, mensaje] — casillas con archivo invalido.
        warnings : list[str] — casillas vacias (el reporte se genera sin ellas).
    """
    widgets, errors, warnings = {}, {}, []

    for key in WIDGET_ORDER:
        entrada = slot_files.get(key)
        if not entrada:
            warnings.append(
                f"No se cargó «{WIDGET_LABELS[key]}» — el reporte se genera sin esa sección."
            )
            continue

        filename, raw = entrada
        df, error = validate_widget(key, raw, filename)
        if error:
            errors[key] = error
            continue

        widgets[key] = df

    return widgets, errors, warnings


def load_widget_bulk(file_storages):
    """
    Clasifica un montón de archivos sueltos por el nombre de su hoja.

    Es el modo por defecto: el usuario suelta los diez export juntos y no tiene
    que acertar dónde va cada uno. Funciona porque el nombre de la hoja lo pone
    Meltwater y sobrevive a que se renombre el archivo, que es lo que sí cambia
    la gente. Un archivo irreconocible se reporta por su nombre en vez de
    desaparecer en silencio.

    Returns
    -------
    (widgets, detected, problems, warnings)
        detected : dict[widget_key, filename] — qué se reconoció como qué.
        problems : list[str] — archivos que no se pudieron usar, y por qué.
        warnings : list[str] — widgets que no llegaron.
    """
    widgets, detected, problems, warnings = {}, {}, [], []

    for f in file_storages:
        filename = getattr(f, 'filename', None) or (f[0] if isinstance(f, tuple) else 'archivo')
        raw = f.read() if hasattr(f, 'read') else f[1]

        try:
            xl = pd.ExcelFile(io.BytesIO(raw))
            sheet_name = xl.sheet_names[0] if xl.sheet_names else ''
        except Exception:
            problems.append(f"«{filename}» no se pudo abrir como Excel (.xlsx).")
            continue

        key = SHEET_TYPE_MAP.get((sheet_name or '').strip().lower())
        if key is None:
            problems.append(
                f"«{filename}» no es un widget reconocido: su hoja se llama «{sheet_name}». "
                f"Si es un export válido, cárgalo desde el modo avanzado."
            )
            continue

        if key in widgets:
            problems.append(
                f"«{filename}» es otro «{WIDGET_LABELS[key]}» y ya había uno cargado; se ignoró."
            )
            continue

        # Se revalida con las mismas reglas que las casillas: un export
        # reconocido pero recortado debe fallar igual en los dos modos.
        df, error = validate_widget(key, raw, filename)
        if error:
            problems.append(error)
            continue

        widgets[key] = df
        detected[key] = filename

    for key in WIDGET_ORDER:
        if key not in widgets:
            warnings.append(
                f"No se cargó «{WIDGET_LABELS[key]}» — el reporte se genera sin esa sección."
            )

    return widgets, detected, problems, warnings


def _safe_num(value, cast=int):
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return 0
        return cast(value)
    except (ValueError, TypeError):
        return 0


def load_widget_files(file_storages):
    """
    Read a list of uploaded .xlsx files and classify them by widget type.

    Parameters
    ----------
    file_storages : list of file-like objects with a `.filename` and
                    `.read()` (e.g. Flask's werkzeug FileStorage, or plain
                    (filename, bytes) tuples for tests).

    Returns
    -------
    (widgets, warnings) : (dict[str, pd.DataFrame], list[str])
        widgets keyed by internal widget type; unrecognized/unreadable
        files are skipped and explained in `warnings`.
    """
    widgets = {}
    warnings = []

    for f in file_storages:
        filename = getattr(f, 'filename', None) or (f[0] if isinstance(f, tuple) else 'archivo')
        raw = f.read() if hasattr(f, 'read') else f[1]

        try:
            xl = pd.ExcelFile(io.BytesIO(raw))
        except Exception as e:
            warnings.append(f"No se pudo leer '{filename}': {e}")
            continue

        sheet_name = xl.sheet_names[0] if xl.sheet_names else ''
        widget_key = SHEET_TYPE_MAP.get(sheet_name.strip().lower())

        if widget_key is None:
            warnings.append(
                f"'{filename}' tiene una hoja no reconocida ('{sheet_name}') y fue ignorado."
            )
            continue

        try:
            df = xl.parse(sheet_name)
        except Exception as e:
            warnings.append(f"No se pudo procesar '{filename}': {e}")
            continue

        if widget_key in widgets:
            warnings.append(
                f"Ya se había cargado un archivo de '{WIDGET_LABELS[widget_key]}'; "
                f"'{filename}' fue ignorado."
            )
            continue

        widgets[widget_key] = df

    for key, label in WIDGET_LABELS.items():
        if key not in widgets:
            warnings.append(f"No se cargó el widget '{label}' — esa sección del reporte quedará vacía.")

    return widgets, warnings


# ─────────────────────────────────────────────────────────────
# Per-widget parsers — each returns plain list[dict] / dict, JSON-ready
# ─────────────────────────────────────────────────────────────

def parse_mentions_trend(df):
    if df is None or df.empty:
        return {'labels': [], 'current': [], 'previous': []}
    cols = list(df.columns)
    prev_col = cols[2] if len(cols) > 2 else None
    return {
        'labels': [translations.date_label(v) for v in df[cols[0]].tolist()],
        'current': [_safe_num(v) for v in df[cols[1]].tolist()],
        'previous': [_safe_num(v) for v in df[prev_col].tolist()] if prev_col else [],
    }


def parse_reach_trend(df):
    if df is None or df.empty:
        return {'labels': [], 'current': [], 'previous': []}
    cols = list(df.columns)
    prev_col = cols[2] if len(cols) > 2 else None
    return {
        'labels': [translations.date_label(v) for v in df[cols[0]].tolist()],
        'current': [_safe_num(v) for v in df[cols[1]].tolist()],
        'previous': [_safe_num(v) for v in df[prev_col].tolist()] if prev_col else [],
    }


def parse_clusters(df):
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    return [
        {'summary': str(row[cols[0]]), 'mentions': _safe_num(row[cols[1]])}
        for _, row in df.iterrows()
    ]


def parse_keywords(df):
    """Splits the stacked 'Keyword' / 'Location' sections in the same sheet."""
    result = {'keywords': [], 'locations': []}
    if df is None or df.empty:
        return result

    cols = list(df.columns)
    current_section = None
    for _, row in df.iterrows():
        first, second = row[cols[0]], row[cols[1]]
        first_str = str(first).strip() if pd.notna(first) else ''

        if pd.isna(second) and first_str.lower() in ('keyword', 'location'):
            current_section = 'keywords' if first_str.lower() == 'keyword' else 'locations'
            continue
        if pd.isna(first) and pd.isna(second):
            continue
        if current_section:
            label_key = 'keyword' if current_section == 'keywords' else 'location'
            result[current_section].append({label_key: first_str, 'mentions': _safe_num(second)})

    return result


def parse_sentiment(df):
    if df is None or df.empty:
        return []
    color_map = {'Negative': '#ad0303', 'Positive': '#07ab50', 'Neutral': '#D3D1D1', 'Not Rated': '#94a3b8'}
    cols = list(df.columns)
    # `key` keeps Meltwater's English label so colours/ordering stay
    # language-independent; `label` is what the report shows.
    return [
        {
            'key': str(row[cols[0]]).strip(),
            'label': translations.sentiment(row[cols[0]]),
            'value': _safe_num(row[cols[1]]),
            'color': color_map.get(str(row[cols[0]]).strip(), '#cccccc'),
        }
        for _, row in df.iterrows()
    ]


def parse_mentions_by_source(df):
    if df is None or df.empty:
        return {'labels': [], 'series': {}}
    cols = list(df.columns)
    date_col, source_cols = cols[0], cols[1:]
    return {
        'labels': [translations.date_label(v) for v in df[date_col].tolist()],
        # Keyed by Meltwater's original source name — the prensa/redes split in
        # calculation.py matches on it. Display names are translated at render.
        'series': {str(c): [_safe_num(v) for v in df[c].tolist()] for c in source_cols},
    }


def parse_sentiment_by_source(df):
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    return [
        {
            'source': translations.source_type(row[cols[0]]),
            'neutral': _safe_num(row[cols[1]]) if len(cols) > 1 else 0,
            'negative': _safe_num(row[cols[2]]) if len(cols) > 2 else 0,
            'positive': _safe_num(row[cols[3]]) if len(cols) > 3 else 0,
            'not_rated': _safe_num(row[cols[4]]) if len(cols) > 4 else 0,
        }
        for _, row in df.iterrows()
    ]


def parse_hashtags(df):
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    return [
        {'hashtag': str(row[cols[0]]), 'mentions': _safe_num(row[cols[1]])}
        for _, row in df.iterrows()
    ]


def parse_emotions(df):
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    return [
        {
            'key': str(row[cols[0]]).strip(),
            'label': translations.emotion(row[cols[0]]),
            'value': _safe_num(row[cols[1]]),
        }
        for _, row in df.iterrows()
    ]


def parse_top_authors(df):
    if df is None or df.empty:
        return []
    cols = list(df.columns)
    records = []
    for _, row in df.iterrows():
        records.append({
            'author': str(row.get('Authors', '')),
            'posts': _safe_num(row.get('Posts')),
            'followers': _safe_num(row.get('Followers')),
            'platform': str(row.get('Social Platform', '')),
            'handle': str(row.get('Handle', '')),
            'url': str(row.get('URL', '')),
            'location': str(row.get('Location', '')) if pd.notna(row.get('Location')) else '',
        })
    return records


PARSERS = {
    'mentions_trend': parse_mentions_trend,
    'reach_trend': parse_reach_trend,
    'clusters': parse_clusters,
    'keywords': parse_keywords,
    'sentiment': parse_sentiment,
    'mentions_by_source': parse_mentions_by_source,
    'sentiment_by_source': parse_sentiment_by_source,
    'hashtags': parse_hashtags,
    'emotions': parse_emotions,
    'top_authors': parse_top_authors,
}


def parse_widgets(widgets):
    """Run the matching parser over every loaded widget DataFrame."""
    parsed = {}
    for key, df in widgets.items():
        parser = PARSERS.get(key)
        if parser:
            parsed[key] = parser(df)
    return parsed
