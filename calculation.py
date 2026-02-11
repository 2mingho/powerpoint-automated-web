import pandas as pd
import numpy as np
from datetime import datetime
import textwrap

# Configuración de fuentes y categorías
SOCIAL_NETWORK_SOURCES = {
    'Twitter': 'Redes Sociales', 'Youtube': 'Redes Sociales',
    'Instagram': 'Redes Sociales', 'Facebook': 'Redes Sociales',
    'Pinterest': 'Redes Sociales', 'Reddit': 'Redes Sociales',
    'TikTok': 'Redes Sociales', 'Twitch': 'Redes Sociales',
}

def format_number(number):
    if number >= 1_000_000:
        return f"{number / 1_000_000:.1f}M"
    elif number >= 1_000:
        return f"{number / 1_000:.1f}k"
    return str(number)

# calculation.py (Solo actualiza la función clean_dataframe, el resto queda igual)

def clean_dataframe(file_path):
    """Carga, limpia y clasifica el DataFrame."""
    try:
        df = pd.read_csv(file_path, encoding='utf-16', sep='\t')
    except UnicodeError:
        # Fallback por si el usuario sube utf-8 por error
        df = pd.read_csv(file_path, encoding='utf-8', sep='\t')

    # Columnas irrelevantes
    columns_to_delete = [
        'Opening Text', 'Subregion', 'Desktop Reach', 'Mobile Reach',
        'Twitter Social Echo', 'Facebook Social Echo', 'Reddit Social Echo',
        'National Viewership', 'State', 'City', 'Social Echo Total',
        'Editorial Echo', 'Views', 'Estimated Views', 'Likes', 'Replies',
        'Retweets', 'Comments', 'Shares', 'Reactions', 'Threads', 'Is Verified'
    ]
    df = df.drop(columns=columns_to_delete, errors='ignore')

    # --- CORRECCIÓN: Asegurar que existe Hit Sentence antes de usarla ---
    if 'Hit Sentence' not in df.columns:
        df['Hit Sentence'] = None # O pd.NA
    
    # Lógica de negocio: Rellenar Hit Sentence con Headline si está vacío
    df['Hit Sentence'] = df['Headline'].where(~df['Headline'].isna(), df['Hit Sentence'])
    
    # Clasificación de Fuentes
    exclude_sources = list(SOCIAL_NETWORK_SOURCES.keys())
    mask = ~df['Source'].isin(exclude_sources)
    df.loc[mask, 'Influencer'] = df.loc[mask, 'Source']
    df['Plataforma'] = df['Source'].apply(lambda x: SOCIAL_NETWORK_SOURCES.get(x, 'Prensa Digital'))

    # Limpieza de nulos en métricas clave
    df['Reach'] = pd.to_numeric(df['Reach'], errors='coerce').fillna(0)
    
    return df

def get_kpis(df):
    """Calcula los indicadores principales."""
    total_mentions = len(df)
    authors = df['Influencer'].nunique()
    # Reach: máximo por influencer para no duplicar en agregaciones simples
    est_reach = df.groupby('Influencer')['Reach'].max().sum()
    
    # Conteo por plataforma
    platform_counts = df['Plataforma'].value_counts().to_dict()
    
    return {
        "total_mentions": int(total_mentions),
        "unique_authors": int(authors),
        "estimated_reach": int(est_reach),
        "estimated_reach_fmt": format_number(est_reach),
        "mentions_prensa": int(platform_counts.get('Prensa Digital', 0)),
        "mentions_redes": int(platform_counts.get('Redes Sociales', 0))
    }

def get_evolution_data(df, use_date_only=False):
    """Prepara datos para el gráfico de línea (JSON friendly)."""
    # Asegurar formato fecha
    df['dt_obj'] = pd.to_datetime(df['Alternate Date Format'], format='%d-%b-%y', errors='coerce')
    
    if use_date_only:
        grouped = df.groupby(df['dt_obj'].dt.date).size()
        labels = [d.strftime('%d-%b') for d in grouped.index]
    else:
        # Agrupar por fecha y hora (simplificado para el gráfico)
        # Nota: El formato original usaba horas, aquí simplificamos para JSON
        grouped = df.groupby(df['dt_obj'].dt.strftime('%Y-%m-%d %H:00')).size()
        labels = [pd.to_datetime(d).strftime('%d-%b %I %p') for d in grouped.index]
        
    return {
        "labels": labels,
        "values": grouped.values.tolist()
    }

def get_sentiment_data(df):
    """Prepara datos para el gráfico de pastel."""
    counts = df[df['Sentiment'] != 'Not Rated']['Sentiment'].value_counts()
    
    # Definir colores fijos para consistencia UI
    color_map = {'Negative': "#ad0303", 'Positive': "#07ab50", 'Neutral': "#D3D1D1"}
    
    data = []
    for label, value in counts.items():
        data.append({
            "label": label,
            "value": int(value),
            "color": color_map.get(label, "#cccccc")
        })
    return data

def get_top_tables(df):
    """Genera las tablas de influencers y frases."""
    
    # 1. Top Prensa
    prensa = df[df['Plataforma'] == "Prensa Digital"]
    top_prensa = prensa.groupby('Influencer')['Reach'].agg(['count', 'max']).reset_index()
    top_prensa.columns = ['Influencer', 'Posts', 'Reach_Raw']
    top_prensa = top_prensa.sort_values('Posts', ascending=False).head(10)
    top_prensa['Reach'] = top_prensa['Reach_Raw'].apply(lambda x: f"{int(x):,}")
    
    # 2. Top Redes (Posts)
    redes = df[df['Plataforma'] == "Redes Sociales"]
    top_redes = redes.groupby('Influencer').agg(
        Posts=('Reach', 'count'),
        Reach_Raw=('Reach', 'max'),
        Source=('Source', 'first')
    ).reset_index()
    
    # Orden por lista: Primero 'Posts' (desc), luego 'Reach_Raw' (desc)
    top_redes = top_redes.sort_values(by=['Posts', 'Reach_Raw'], ascending=[False, False]).head(10)
    top_redes['Reach'] = top_redes['Reach_Raw'].apply(lambda x: f"{int(x):,}")

    # 3. Hit Sentences
    top_hits = df[df['Plataforma'] == "Prensa Digital"].sort_values(by='Reach', ascending=False).head(5)
    hit_sentences = [
        textwrap.fill(s, width=100) for s in top_hits['Hit Sentence'].fillna("").astype(str).tolist()
    ]

    return {
        "top_prensa": top_prensa.drop(columns=['Reach_Raw']).to_dict(orient='records'),
        "top_redes": top_redes.drop(columns=['Reach_Raw']).to_dict(orient='records'),
        "top_sentences": hit_sentences
    }

def create_report_context(file_path, report_title=None):
    """
    FUNCIÓN PRINCIPAL
    Orquesta la lectura y genera el diccionario maestro (JSON)
    que usará el Frontend, el PPTX y el PDF.
    """
    df = clean_dataframe(file_path)
    
    # Obtener metadatos
    client_name = report_title if report_title else "Reporte General"
    
    # Construir el objeto JSON universal
    context = {
        "meta": {
            "client_name": client_name,
            "date_generated": datetime.now().strftime('%d-%b-%Y'),
            "file_name": file_path
        },
        "kpis": get_kpis(df),
        "charts": {
            "evolution": get_evolution_data(df),
            "sentiment": get_sentiment_data(df)
        },
        "tables": get_top_tables(df),
        # Espacio reservado para análisis de IA (Groq)
        "ai_analysis": {
            "summary": "Pendiente de generación...",
            "raw_text": "\n".join(df['Hit Sentence'].dropna().astype(str).tolist()[:50])
        }
    }
    
    return context