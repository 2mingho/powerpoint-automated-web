import pandas as pd
from datetime import datetime

from services import translations

PRENSA_SOURCE = 'News - Online'

# Usado por services/classifier.py (herramienta de Clasificación, no forma
# parte del flujo de generación de reportes v2).
SOCIAL_NETWORK_SOURCES = {
    'Twitter': 'Redes Sociales', 'Youtube': 'Redes Sociales',
    'Instagram': 'Redes Sociales', 'Facebook': 'Redes Sociales',
    'Pinterest': 'Redes Sociales', 'Reddit': 'Redes Sociales',
    'TikTok': 'Redes Sociales', 'Twitch': 'Redes Sociales',
}


def clean_dataframe(file_path):
    """Carga, limpia y clasifica el DataFrame (mención-por-fila, legacy).

    Usado únicamente por services/classifier.py:classify_mentions() — la
    herramienta de Clasificación sigue trabajando con exports mención-por-fila
    y está fuera del alcance del rediseño de generación de reportes v2.
    """
    try:
        df = pd.read_csv(file_path, encoding='utf-16', sep='\t')
    except UnicodeError:
        df = pd.read_csv(file_path, encoding='utf-8', sep='\t')

    columns_to_delete = [
        'Opening Text', 'Subregion', 'Desktop Reach', 'Mobile Reach',
        'Twitter Social Echo', 'Facebook Social Echo', 'Reddit Social Echo',
        'National Viewership', 'State', 'City', 'Social Echo Total',
        'Editorial Echo', 'Views', 'Estimated Views', 'Likes', 'Replies',
        'Retweets', 'Comments', 'Shares', 'Reactions', 'Threads', 'Is Verified'
    ]
    df = df.drop(columns=columns_to_delete, errors='ignore')

    if 'Hit Sentence' not in df.columns:
        df['Hit Sentence'] = None

    df['Hit Sentence'] = df['Headline'].where(~df['Headline'].isna(), df['Hit Sentence'])

    exclude_sources = list(SOCIAL_NETWORK_SOURCES.keys())
    mask = ~df['Source'].isin(exclude_sources)
    df.loc[mask, 'Influencer'] = df.loc[mask, 'Source']
    df['Plataforma'] = df['Source'].apply(lambda x: SOCIAL_NETWORK_SOURCES.get(x, 'Prensa Digital'))

    df['Reach'] = pd.to_numeric(df['Reach'], errors='coerce').fillna(0)

    return df


MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def _fecha_es(dt):
    """22-Aug-2026 -> '22 de agosto de 2026'."""
    return f"{dt.day} de {MESES_ES[dt.month - 1]} de {dt.year}"


# Convención de números del reporte: coma para los miles y punto para los
# decimales (33,146 y 13.6%), como se usa en República Dominicana. Los dos
# signos van emparejados a propósito: usar la coma para ambas cosas haría
# ambiguo un número como "1,5".
def es_num(n):
    """33146 -> '33,146'."""
    return f"{int(n):,}"


def es_pct(v):
    """13.6 -> '13.6'. El punto separa decimales."""
    return str(v)


def format_number(number):
    """Cifra compacta: 15800000000 -> '15.8 B'."""
    if number >= 1_000_000_000:
        return f"{number / 1_000_000_000:.1f} B"
    elif number >= 1_000_000:
        return f"{number / 1_000_000:.1f} M"
    elif number >= 1_000:
        return f"{number / 1_000:.1f} k"
    return es_num(number)


def _pct_change(current, previous):
    if not previous:
        return None
    return round((current - previous) / previous * 100, 1)


def _build_kpis(parsed, unique_authors=None):
    mentions = parsed.get('mentions_trend', {})
    reach = parsed.get('reach_trend', {})
    by_source = parsed.get('mentions_by_source', {})

    total_mentions = sum(mentions.get('current', []))
    total_mentions_prev = sum(mentions.get('previous', []))
    estimated_reach = sum(reach.get('current', []))
    estimated_reach_prev = sum(reach.get('previous', []))

    mentions_by_source = {src: sum(vals) for src, vals in by_source.get('series', {}).items()}
    mentions_prensa = mentions_by_source.get(PRENSA_SOURCE, 0)
    mentions_redes = sum(v for src, v in mentions_by_source.items() if src != PRENSA_SOURCE)

    top_authors = parsed.get('top_authors', [])

    return {
        'total_mentions': total_mentions,
        'total_mentions_prev': total_mentions_prev,
        'mentions_change_pct': _pct_change(total_mentions, total_mentions_prev),
        'estimated_reach': estimated_reach,
        'estimated_reach_fmt': format_number(estimated_reach),
        'estimated_reach_prev': estimated_reach_prev,
        'reach_change_pct': _pct_change(estimated_reach, estimated_reach_prev),
        'mentions_prensa': mentions_prensa,
        'mentions_redes': mentions_redes,
        'mentions_by_source': mentions_by_source,
        # La clave cruda de Meltwater manda en la logica (el reparto prensa/redes
        # se decide por ella), pero al usuario hay que ensenarle el nombre en
        # espanol: sin este mapa, "News - Online" convivia en el mismo reporte
        # con "Noticias digitales" del grafico de sentimiento por red.
        'source_labels': {src: translations.source_type(src) for src in mentions_by_source},
        'top_authors_shown': len(top_authors),
        # Ningún widget trae el total de autores únicos, pero Meltwater lo muestra
        # en pantalla: lo teclea el analista. None = no lo indicó, y entonces el
        # KPI no se pinta en vez de enseñar un cero que parecería un dato real.
        'unique_authors': unique_authors,
        'unique_authors_fmt': format_number(unique_authors) if unique_authors else None,
    }


def _build_charts(parsed):
    mentions = parsed.get('mentions_trend', {})
    reach = parsed.get('reach_trend', {})

    return {
        'evolution': {
            'labels': mentions.get('labels', []),
            'mentions': mentions.get('current', []),
            'mentions_prev': mentions.get('previous', []),
        },
        'reach_evolution': {
            'labels': reach.get('labels', []),
            'reach': reach.get('current', []),
            'reach_prev': reach.get('previous', []),
        },
        'sentiment': parsed.get('sentiment', []),
        'sentiment_by_source': parsed.get('sentiment_by_source', []),
        'emotions': parsed.get('emotions', []),
        'mentions_by_source_trend': parsed.get('mentions_by_source', {'labels': [], 'series': {}}),
    }


def _translate_clusters(clusters):
    """Traduce los resumenes de clusters, que Meltwater entrega en ingles.

    Si no hay proveedor de IA configurado se devuelven intactos: el reporte se
    genera igual, solo que esa seccion queda en el idioma original.
    """
    if not clusters:
        return clusters
    try:
        from services import ai_provider
        traducidos = ai_provider.translate_texts([c['summary'] for c in clusters])
    except Exception:
        return clusters

    return [
        {**cluster, 'summary': texto}
        for cluster, texto in zip(clusters, traducidos)
    ]


def _build_content(parsed):
    keywords_data = parsed.get('keywords', {'keywords': [], 'locations': []})
    return {
        'clusters': _translate_clusters(parsed.get('clusters', [])),
        'keywords': keywords_data.get('keywords', []),
        'locations': keywords_data.get('locations', []),
        'hashtags': parsed.get('hashtags', []),
        'top_authors': parsed.get('top_authors', []),
    }


def generate_narrative(context):
    """
    Builds a plain-language Spanish narrative from the aggregated numbers.
    No LLM involved — purely rule-based, mirroring the insight generator
    used by services/csv_analysis.py.
    """
    kpis = context['kpis']
    charts = context['charts']
    content = context['content']

    # Overview
    overview_parts = [f"Se registraron {es_num(kpis['total_mentions'])} menciones"]
    if kpis['mentions_change_pct'] is not None:
        direction = 'un aumento' if kpis['mentions_change_pct'] >= 0 else 'una caída'
        overview_parts.append(f"lo que representa {direction} del {es_pct(abs(kpis['mentions_change_pct']))}% frente al periodo anterior")
    overview_parts.append(f"con un alcance estimado de {kpis['estimated_reach_fmt']}")
    if kpis.get('unique_authors'):
        overview_parts.append(f"generadas por {es_num(kpis['unique_authors'])} autores únicos")
    overview = ", ".join(overview_parts) + "."

    # Sentiment
    sentiment_summary = ""
    if charts['sentiment']:
        rated = [s for s in charts['sentiment'] if s.get('key', s['label']) != 'Not Rated']
        if rated:
            dominant = max(rated, key=lambda s: s['value'])
            total_rated = sum(s['value'] for s in rated) or 1
            pct = round(dominant['value'] / total_rated * 100, 1)
            sentiment_summary = f"El sentimiento predominante fue {dominant['label']} ({es_pct(pct)}% de las menciones calificadas)."
            if charts['emotions']:
                top_emotion = max(charts['emotions'], key=lambda e: e['value'])
                sentiment_summary += f" La emoción más frecuente en la conversación fue '{top_emotion['label']}'."

    # Topics
    topics_summary = ""
    if content['clusters']:
        top_cluster = max(content['clusters'], key=lambda c: c['mentions'])
        topics_summary = f"El tema con mayor volumen de conversación fue: \"{top_cluster['summary']}\" ({es_num(top_cluster['mentions'])} menciones)."
    if content['hashtags']:
        top_hashtag = max(content['hashtags'], key=lambda h: h['mentions'])
        topics_summary += f" El hashtag más utilizado fue #{top_hashtag['hashtag']} ({es_num(top_hashtag['mentions'])} menciones)."

    # Closing
    closing_parts = []
    if kpis['mentions_prensa'] or kpis['mentions_redes']:
        closing_parts.append(
            f"La conversación se distribuyó en {es_num(kpis['mentions_prensa'])} menciones de prensa digital "
            f"y {es_num(kpis['mentions_redes'])} menciones en redes sociales."
        )
    if content['top_authors']:
        top_author = max(content['top_authors'], key=lambda a: a['posts'])
        closing_parts.append(f"El autor con más publicaciones fue {top_author['author']} ({top_author['posts']} posts).")
    closing = " ".join(closing_parts)

    return {
        'overview': overview,
        'sentiment_summary': sentiment_summary,
        'topics_summary': topics_summary,
        'closing': closing,
    }


def _deterministic_insights(context):
    """Rellena los mismos slots que el harness, sin modelo.

    Es el suelo del reporte: siempre existe, no depende de red ni de claves, y
    garantiza que el PPTX se genera aunque no haya IA configurada.
    """
    kpis = context['kpis']
    charts = context['charts']
    content = context['content']
    narrative = context['narrative']

    slots = {
        'volume_title': 'Así se movió la conversación',
        'volume_take': narrative['overview'],
        'sentiment_title': 'Cómo se sintió la conversación',
        'sentiment_take': narrative['sentiment_summary'],
        'by_source_title': 'Sentimiento por red',
        'by_source_take': '',
        'topics_title': 'De qué se habló',
        'topics_take': narrative['topics_summary'],
        'authors_title': 'Quién llevó la conversación',
        'authors_take': narrative['closing'],
        'conclusion_1': narrative['overview'],
        'conclusion_2': narrative['sentiment_summary'],
        'conclusion_3': narrative['topics_summary'],
    }

    # La lamina de sentimiento por red solo tiene texto si hay datos que cruzar.
    por_red = charts.get('sentiment_by_source') or []
    con_volumen = [s for s in por_red if (s['neutral'] + s['negative'] + s['positive']) > 0]
    if con_volumen:
        peor = max(con_volumen,
                   key=lambda s: s['negative'] / (s['neutral'] + s['negative'] + s['positive']))
        total_peor = peor['neutral'] + peor['negative'] + peor['positive']
        pct_peor = round(peor['negative'] / total_peor * 100, 1)
        slots['by_source_take'] = (
            f"{peor['source']} concentra la mayor proporción de menciones negativas "
            f"({es_pct(pct_peor)}% de sus {es_num(total_peor)} menciones)."
        )

    return slots


def create_report_context_from_widgets(parsed_widgets, report_title=None, warnings=None,
                                       use_ai_insights=True, unique_authors=None,
                                       meltwater_analysis=None):
    """
    FUNCIÓN PRINCIPAL (v2)
    Orquesta la construcción del contexto JSON maestro a partir de los
    widgets .xlsx de Meltwater ya parseados (services.meltwater_ingest.parse_widgets).
    """
    client_name = report_title if report_title else "Reporte General"

    context = {
        'meta': {
            'client_name': client_name,
            'date_generated': _fecha_es(datetime.now()),
        },
        'kpis': _build_kpis(parsed_widgets, unique_authors=unique_authors),
        'charts': _build_charts(parsed_widgets),
        'content': _build_content(parsed_widgets),
        'warnings': warnings or [],
        # Contexto cualitativo opcional que el analista pega de Meltwater. Solo
        # lo consume el harness; no se muestra en el reporte.
        'meltwater_analysis': (meltwater_analysis or '').strip(),
    }
    context['narrative'] = generate_narrative(context)

    # Los insights escritos: primero el suelo determinista, y encima el modelo
    # si hay uno configurado y su respuesta supera la validacion.
    context['insights'] = _deterministic_insights(context)
    context['insights_source'] = 'reglas'

    if use_ai_insights:
        try:
            from services import insight_harness
            generados, meta = insight_harness.generate_insights(context)
        except Exception:
            generados, meta = None, {'ok': False, 'reason': 'el harness de insights falló'}

        if generados:
            context['insights'] = generados
            context['insights_source'] = 'ia'
        elif meta.get('reason') and 'no hay proveedor' not in meta['reason']:
            # Un descarte por validacion es informacion que el analista debe ver.
            context['warnings'].append(
                f"Los insights de IA se descartaron ({meta['reason']}). "
                f"Se usó el texto generado por reglas."
            )

    # Ya cumplió su función: se retira para no viajar al navegador dentro del
    # JSON del reporte, donde solo añadiría peso sin mostrarse.
    context.pop('meltwater_analysis', None)

    return context
