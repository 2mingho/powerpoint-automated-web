import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
import matplotlib
matplotlib.use('Agg') # Backend no interactivo para servidor
import matplotlib.pyplot as plt
import numpy as np

# Configuración de estilo
FONT_NAME = 'Poppins' # Puedes cambiar a 'Poppins' si la tienes instalada en el servidor

def set_text_style(shape, text, font_size=Pt(14), bold=False, color=RGBColor(0,0,0)):
    """Helper para aplicar estilos a cuadros de texto"""
    if not shape.has_text_frame: return
    text_frame = shape.text_frame
    text_frame.clear() 
    p = text_frame.paragraphs[0]
    p.text = str(text)
    p.font.name = FONT_NAME
    p.font.size = font_size
    p.font.bold = bold
    p.font.color.rgb = color
    p.alignment = PP_ALIGN.CENTER

def create_temp_charts(data):
    """Regenera los gráficos basados en los datos EDITADOS (JSON)"""
    paths = {}
    os.makedirs('scratch', exist_ok=True)

    # 1. Gráfico de Sentimiento (Pastel)
    sent_data = data['charts']['sentiment']
    labels = [d['label'] for d in sent_data]
    values = [d['value'] for d in sent_data]
    colors = [d['color'] for d in sent_data]

    fig, ax = plt.subplots(figsize=(6, 6))
    wedges, texts, autotexts = ax.pie(values, labels=labels, autopct='%1.1f%%', colors=colors, startangle=90)
    plt.setp(autotexts, size=12, weight="bold", color="white")
    plt.title("Distribución de Sentimiento")
    
    sent_path = 'scratch/temp_sentiment.png'
    plt.savefig(sent_path, transparent=True, dpi=100)
    plt.close(fig)
    paths['sentiment'] = sent_path

    # 2. Gráfico de Evolución (Línea)
    evo_data = data['charts']['evolution']
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(evo_data['labels'], evo_data['values'], color='orange', linewidth=3, marker='o')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    plt.xticks(rotation=45, ha='right')
    plt.tight_layout()
    
    evo_path = 'scratch/temp_evolution.png'
    plt.savefig(evo_path, transparent=True, dpi=100)
    plt.close(fig)
    paths['evolution'] = evo_path

    return paths

def generate_pptx(json_data, template_path, output_path):
    """Función Maestra: Convierte el JSON en PPTX"""
    
    prs = Presentation(template_path)
    
    # 1. Regenerar gráficos con los datos editados
    chart_images = create_temp_charts(json_data)

    # 2. Mapeo de Textos Simples (Buscamos coincidencias en todos los slides)
    # Clave en JSON -> Valor a mostrar
    text_replacements = {
        "REPORT_CLIENT": json_data['meta']['client_name'],
        "REPORT_DATE": json_data['meta']['date_generated'],
        "NUMB_MENTIONS": str(json_data['kpis']['total_mentions']),
        "NUMB_ACTORS": str(json_data['kpis']['unique_authors']),
        "EST_REACH": json_data['kpis']['estimated_reach_fmt'],
        "NUMB_PRENSA": str(json_data['kpis']['mentions_prensa']),
        "NUMB_REDES": str(json_data['kpis']['mentions_redes'])
    }

    # Recorremos slides buscando placeholders de TEXTO
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for key, value in text_replacements.items():
                    if key in shape.text:
                        set_text_style(shape, value, font_size=Pt(24), bold=True)

    # 3. Inserción de Gráficos (Buscamos por 'alt text' o contenido previo)
    # Nota: Para hacerlo robusto, asumimos que tienes un placeholder llamado 'SENTIMENT_CHART'
    # Si no, buscaremos una imagen existente para reemplazarla o la pondremos en un slide específico via índice.
    # Por ahora, usaré un método de búsqueda genérico por texto.
    
    def replace_image_placeholder(keyword, image_path):
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame and keyword in shape.text:
                    # Guardamos coordenadas
                    left, top, width, height = shape.left, shape.top, shape.width, shape.height
                    # Borramos el texto placeholder
                    shape.text = "" 
                    # Insertamos la imagen encima
                    slide.shapes.add_picture(image_path, left, top, width=width, height=height)

    replace_image_placeholder("SENTIMENT_PIE", chart_images['sentiment'])
    replace_image_placeholder("CONVERSATION_CHART", chart_images['evolution'])

    # 4. Tablas (Nativas y Editables)
    # Necesitamos encontrar dónde poner la tabla. 
    # Buscaremos un cuadro de texto que diga 'TABLE_PRENSA'
    
    def create_native_table(slide, shape, data_list, headers):
        # Eliminar el placeholder
        left, top, width, height = shape.left, shape.top, shape.width, shape.height
        sp = shape._element
        sp.getparent().remove(sp)
        
        # Crear tabla nueva
        rows = len(data_list) + 1
        cols = len(headers)
        table = slide.shapes.add_table(rows, cols, left, top, width, height).table
        
        # Headers
        for i, header in enumerate(headers):
            cell = table.cell(0, i)
            cell.text = header
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(255, 192, 0) # Naranja/Dorado
        
        # Data
        for row_idx, row_data in enumerate(data_list):
            # Asumiendo que row_data es un dict y headers coinciden con las llaves
            keys = list(row_data.keys()) # ['Influencer', 'Posts', 'Reach']
            for col_idx, key in enumerate(keys):
                table.cell(row_idx+1, col_idx).text = str(row_data[key])

    # Buscar placeholders de tablas
    for slide in prs.slides:
        # Hacemos una copia de la lista de shapes porque vamos a borrar elementos
        for shape in list(slide.shapes):
            if shape.has_text_frame:
                if 'TOP_INFLUENCERS_PRENSA_TABLE' in shape.text:
                    create_native_table(slide, shape, json_data['tables']['top_prensa'], ['Influencer', 'Posts', 'Reach'])
                elif 'TOP_INFLUENCERS_REDES_TABLE' in shape.text:
                    create_native_table(slide, shape, json_data['tables']['top_redes'], ['Influencer', 'Posts', 'Reach', 'Source'])

    prs.save(output_path)
    return output_path