import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from . import native_charts

# Configuración de estilo
FONT_NAME = 'Arial' 

def set_text_style(shape, text, font_name=None, font_size=Pt(14), bold=False, color=RGBColor(0,0,0), alignment=PP_ALIGN.LEFT):
    """Helper para aplicar estilos a cuadros de texto"""
    if not shape.has_text_frame: return
    text_frame = shape.text_frame
    text_frame.clear() 
    p = text_frame.paragraphs[0]
    p.text = str(text)
    p.font.name = font_name if font_name else FONT_NAME
    p.font.size = font_size
    p.font.bold = bold
    p.font.color.rgb = color
    p.alignment = alignment

def add_dataframe_as_table(slide, data_or_shape, headers_or_data=None, left=None, top=None, width=None, height=None, headers=None):
    """
    Add a DataFrame or list-of-dicts as a native PowerPoint table.
    
    Supports two calling patterns:
    1. (slide, shape, data_list, headers) — replaces a placeholder shape
    2. (slide, data_list, left, top, width, height) — positions explicitly (legacy app.py pattern)
    """
    # Determine calling pattern
    if hasattr(data_or_shape, 'left'):
        # Pattern 1: shape-based — extract position from shape, remove it
        shape = data_or_shape
        data_list = headers_or_data if headers_or_data is not None else []
        final_left, final_top = shape.left, shape.top
        final_width = width if width else shape.width
        final_height = height if height else shape.height
        # Remove placeholder
        sp = shape._element
        sp.getparent().remove(sp)
    else:
        # Pattern 2: explicit positioning (legacy app.py pattern)
        # data_or_shape is actually the data (DataFrame or list)
        data_list = data_or_shape
        if headers is None and isinstance(headers_or_data, (int, float)):
            # Called as (slide, data, left, top, width, height)
            final_left = headers_or_data  # Actually 'left'
            final_top = left              # Actually 'top'  
            final_width = top             # Actually 'width'
            final_height = width          # Actually 'height'
            headers = None
        else:
            final_left = left
            final_top = top
            final_width = width
            final_height = height

    # Convert DataFrame to list of dicts if needed
    if hasattr(data_list, 'to_dict'):
        if headers is None:
            headers = list(data_list.columns)
        data_list = data_list.to_dict(orient='records')
    
    if headers is None:
        headers = list(data_list[0].keys()) if data_list else []

    # Standard slide dimensions (13.333" x 7.5" for widescreen)
    SLIDE_WIDTH = Inches(13.333)
    SLIDE_HEIGHT = Inches(7.5)
    
    # Override with requested dimensions and center
    final_width = Inches(7.88)
    final_height = Inches(4.07)
    final_left = int((SLIDE_WIDTH - final_width) / 2)
    final_top = int((SLIDE_HEIGHT - final_height) / 2)

    rows = len(data_list) + 1
    cols = len(headers)
    if cols == 0:
        return

    table = slide.shapes.add_table(rows, cols, final_left, final_top, final_width, final_height).table

    # Headers
    for i, header in enumerate(headers):
        cell = table.cell(0, i)
        cell.text = header
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor(255, 192, 0)
        cell.text_frame.paragraphs[0].font.bold = True
        cell.text_frame.paragraphs[0].font.size = Pt(12)
        cell.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER

    # Data
    for row_idx, row_data in enumerate(data_list):
        for col_idx, header in enumerate(headers):
            cell = table.cell(row_idx + 1, col_idx)
            cell.text = str(row_data.get(header, ''))
            cell.text_frame.paragraphs[0].font.size = Pt(10)
            cell.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE


def _fmt_pct(value):
    if value is None:
        return "s/d"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value}%"


def _build_text_tokens(data):
    kpis = data['kpis']
    narrative = data.get('narrative', {})

    # Los insights escritos (por reglas o por el modelo) se exponen como
    # INSIGHT_<SLOT>, de modo que la plantilla los coloque sin saber su origen.
    insight_tokens = {
        f"INSIGHT_{slot.upper()}": value
        for slot, value in (data.get('insights') or {}).items()
    }

    return {
        **insight_tokens,
        "REPORT_CLIENT": data['meta']['client_name'],
        "REPORT_DATE": data['meta']['date_generated'],
        "NUMB_MENTIONS": str(kpis['total_mentions']),
        "MENTIONS_CHANGE_PCT": _fmt_pct(kpis.get('mentions_change_pct')),
        "EST_REACH": kpis['estimated_reach_fmt'],
        "REACH_CHANGE_PCT": _fmt_pct(kpis.get('reach_change_pct')),
        "NUMB_PRENSA": str(kpis['mentions_prensa']),
        "NUMB_REDES": str(kpis['mentions_redes']),
        "TOP_AUTHORS_SHOWN": str(kpis.get('top_authors_shown', 0)),
        "NARRATIVE_OVERVIEW": narrative.get('overview', ''),
        "NARRATIVE_SENTIMENT": narrative.get('sentiment_summary', ''),
        "NARRATIVE_TOPICS": narrative.get('topics_summary', ''),
        "NARRATIVE_CLOSING": narrative.get('closing', ''),
    }


# Styling rule (keyword match on token name) -> set_text_style kwargs
def _style_for_token(key):
    if key.endswith("_TITLE"):
        return dict(font_size=Pt(30), bold=True, alignment=PP_ALIGN.LEFT)
    if key.startswith("INSIGHT_"):
        # Takeaways y conclusiones: texto corrido, alineado a la izquierda.
        return dict(font_size=Pt(15), bold=False, alignment=PP_ALIGN.LEFT)
    if key.startswith("NARRATIVE_"):
        return dict(font_size=Pt(11), bold=False, alignment=PP_ALIGN.LEFT)
    if key.endswith("_CHANGE_PCT"):
        return dict(font_size=Pt(16), bold=True, alignment=PP_ALIGN.CENTER)
    if key.startswith("NUMB_") or key == "EST_REACH":
        return dict(font_size=Pt(28), bold=True, alignment=PP_ALIGN.CENTER)
    if key == "REPORT_DATE":
        return dict(font_size=Pt(24), bold=True, color=RGBColor(255, 255, 255), alignment=PP_ALIGN.CENTER)
    return dict(font_size=Pt(24), bold=True, alignment=PP_ALIGN.CENTER)


def _build_chart_tokens(data):
    charts = data['charts']
    evo = charts['evolution']
    reach = charts['reach_evolution']
    sent_by_source = charts.get('sentiment_by_source', [])
    keywords = data['content'].get('keywords', [])[:10]
    hashtags = data['content'].get('hashtags', [])[:10]

    tokens = {
        'SENTIMENT_PIE': lambda slide, shape: native_charts.add_native_pie_chart(
            slide, shape, charts['sentiment'], width=Inches(5.75), height=Inches(5.09)),
        'CONVERSATION_CHART': lambda slide, shape: native_charts.add_native_line_chart(
            slide, shape, evo['labels'], evo['mentions'], width=Inches(9.07), height=Inches(5.15)),
        'REACH_TREND_CHART': lambda slide, shape: native_charts.add_native_line_chart(
            slide, shape, reach['labels'], reach['reach'], series_name='Alcance',
            width=Inches(9.07), height=Inches(5.15)),
    }

    if keywords:
        tokens['KEYWORDS_BAR_CHART'] = lambda slide, shape: native_charts.add_native_bar_chart(
            slide, shape, [k['keyword'] for k in keywords], [k['mentions'] for k in keywords])
    if hashtags:
        tokens['HASHTAGS_BAR_CHART'] = lambda slide, shape: native_charts.add_native_bar_chart(
            slide, shape, [f"#{h['hashtag']}" for h in hashtags], [h['mentions'] for h in hashtags])
    if sent_by_source:
        series = {
            'Neutral': [s['neutral'] for s in sent_by_source],
            'Negativo': [s['negative'] for s in sent_by_source],
            'Positivo': [s['positive'] for s in sent_by_source],
        }
        tokens['SENTIMENT_BY_SOURCE_CHART'] = lambda slide, shape: native_charts.add_native_stacked_bar_chart(
            slide, shape, [s['source'] for s in sent_by_source], series)

    return tokens


def _build_table_tokens(data):
    content = data['content']
    tokens = {}
    if content.get('clusters'):
        rows = [{'Tema': c['summary'], 'Menciones': c['mentions']} for c in content['clusters'][:10]]
        tokens['CLUSTERS_TABLE'] = (rows, ['Tema', 'Menciones'])
    if content.get('top_authors'):
        rows = [
            {'Autor': a['author'], 'Plataforma': a['platform'], 'Posts': a['posts'], 'Seguidores': a['followers']}
            for a in content['top_authors'][:10]
        ]
        tokens['TOP_AUTHORS_TABLE'] = (rows, ['Autor', 'Plataforma', 'Posts', 'Seguidores'])
    if content.get('hashtags'):
        rows = [{'Hashtag': f"#{h['hashtag']}", 'Menciones': h['mentions']} for h in content['hashtags'][:10]]
        tokens['HASHTAGS_TABLE'] = (rows, ['Hashtag', 'Menciones'])
    return tokens


def generate_pptx(json_data, template_path, output_path):
    """
    Motor de plantillas v2: recorre las slides una sola vez e indexa los
    shapes con texto de placeholder ('REPORT_CLIENT', 'SENTIMENT_PIE', ...),
    luego rellena cada tipo de token (texto, gráfico nativo, tabla) contra
    ese índice. Extender el reporte con un token nuevo es agregar una
    entrada a _build_text_tokens/_build_chart_tokens/_build_table_tokens,
    sin tocar esta función.
    """
    prs = Presentation(template_path)

    placeholder_index = {}
    for slide in prs.slides:
        for shape in list(slide.shapes):
            try:
                if shape.has_text_frame and shape.text.strip():
                    placeholder_index[shape.text.strip()] = (slide, shape)
            except Exception:
                continue

    # --- Texto ---
    for key, value in _build_text_tokens(json_data).items():
        slide, shape = placeholder_index.get(key, (None, None))
        if shape:
            set_text_style(shape, value, **_style_for_token(key))

    # --- Gráficos nativos ---
    for key, render_fn in _build_chart_tokens(json_data).items():
        slide, shape = placeholder_index.get(key, (None, None))
        if shape:
            render_fn(slide, shape)

    # --- Tablas ---
    for key, (rows, headers) in _build_table_tokens(json_data).items():
        slide, shape = placeholder_index.get(key, (None, None))
        if shape:
            add_dataframe_as_table(slide, shape, rows, headers=headers)

    prs.save(output_path)
    return output_path