"""
services/translations.py
------------------------
Meltwater exports its widget labels in English regardless of the language of
the conversation being analysed. The reports Newlink delivers are in Spanish,
so every label that comes from a *closed set* is translated here with a static
map — deterministic, offline, and free.

Free-form text (the AI-Powered Clusters summaries) is NOT handled here: those
sentences differ in every report and need a real translator. See
services/ai_provider.py for that path.
"""

# Meltwater's "Emotional Comparison" widget
EMOTIONS = {
    'Anger': 'Enojo',
    'Disgust': 'Desagrado',
    'Joy': 'Alegría',
    'Surprise': 'Sorpresa',
    'Fear': 'Miedo',
    'Sadness': 'Tristeza',
}

# Meltwater's "Sentiment" widget
SENTIMENT = {
    'Positive': 'Positivo',
    'Negative': 'Negativo',
    'Neutral': 'Neutral',
    'Not Rated': 'Sin calificar',
}

# Meltwater's source types, as they appear in the by-source widgets.
# Names that are already proper nouns (X, YouTube, Facebook…) stay as-is.
SOURCE_TYPES = {
    'News - Online': 'Noticias digitales',
    'Blogs': 'Blogs',
    'Comments': 'Comentarios',
    'Forums': 'Foros',
    'Bluesky': 'Bluesky',
    'X': 'X',
    'YouTube': 'YouTube',
    'Facebook': 'Facebook',
    'Instagram': 'Instagram',
    'Reddit': 'Reddit',
    'LinkedIn': 'LinkedIn',
    'Pinterest': 'Pinterest',
    'TikTok': 'TikTok',
    'Podcasts': 'Podcasts',
    'Print': 'Prensa impresa',
    'Broadcast': 'Radio y TV',
    'Reviews': 'Reseñas',
}


# Meltwater etiqueta el eje temporal en inglés ("Aug 16", "Sep 3").
MONTHS = {
    'Jan': 'ene', 'Feb': 'feb', 'Mar': 'mar', 'Apr': 'abr',
    'May': 'may', 'Jun': 'jun', 'Jul': 'jul', 'Aug': 'ago',
    'Sep': 'sep', 'Oct': 'oct', 'Nov': 'nov', 'Dec': 'dic',
}


def date_label(value):
    """'Aug 16' -> '16 ago'. Devuelve el original si no encaja el patrón."""
    if value is None:
        return ''
    texto = str(value).strip()
    partes = texto.split()
    if len(partes) == 2:
        mes, dia = partes
        if mes[:3] in MONTHS and dia.isdigit():
            return f"{int(dia)} {MONTHS[mes[:3]]}"
        # Algunos exports invierten el orden: "16 Aug"
        if dia[:3] in MONTHS and mes.isdigit():
            return f"{int(mes)} {MONTHS[dia[:3]]}"
    return texto


def _lookup(table, value):
    """Translate *value* via *table*, falling back to the original string.

    An unknown label is a Meltwater addition we haven't mapped yet; showing it
    untranslated is better than showing nothing or crashing the report.
    """
    if value is None:
        return ''
    return table.get(str(value).strip(), str(value).strip())


def emotion(value):
    return _lookup(EMOTIONS, value)


def sentiment(value):
    return _lookup(SENTIMENT, value)


def source_type(value):
    return _lookup(SOURCE_TYPES, value)
