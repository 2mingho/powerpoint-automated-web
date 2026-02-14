# IMPORTS DE LAS LIBRERÍAS QUE NECESITO
import pandas as pd
import numpy as np
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
from wordcloud import WordCloud, STOPWORDS, ImageColorGenerator
import textwrap
import os
from os import path
import requests

# DEFINICIóN DE LOS MEDIOS DE LA COLUMNA 'INFLUENCER' QUE VAN A SER CATEGORIZADOS COMO PRENSA DIGITAL EN LA COLUMNA 'PLATAFORMA' Y SU SENTIMIENTO SERÁ NEUTRAL EN LA COLUMNA 'SENTIMENT'
social_networks_prensa = ['@EdeesteRD','@edeesterd', "edenorterd", "edesurrd", '@precisionportal', 'panoramatv_',
                          '@mananerord', '@noticiaspimentl', '@MIC_RD',"siegobrd",
                          '@soldelamananard', '@drmariolama', '@labazucaenlared',
                          '@eldia_do', '@diariosaluddo',
                          '@noticiasrnn',
                          '@periodicohoy',
                          '@telemicrohd',
                          '@precisionportal',
                          '@telenoticiasrd',
                          '@sin24horas',
                          'sin24horas',
                          '@diariolibre',
                          'diariolibre',
                          '@cdn37',
                          'cdn.com.do',
                          '@listindiario',
                          'listindiario',
                          'bavaronews',
                          '@acentodiario',
                          '@anoticias7',
                          '@z101digital',
                          'z101digital',
                          'revista110',
                          'rcavada',
                          '@rcavada',
                          'robertocavada',
                          'ndigital',
                          'bavarodigital',
                          '@elnuevodiariord',
                          '@acentodiario',
                          '@deultimominutomedia',
                          '@aeromundo_ggomez',
                          '@cachichatv',
                          '@remolachanews',
                          '@ntelemicro5',
                          '@megadiariord',
                          '@noticiasmn',
                          '@eldemocratard',
                          '@elpregonerord',
                          '@infoturdom',
                          '@comunidadojala',
                          '@panorama_do', '@panoramard1',
                          '@invertix',
                          '@derechoasaberlo',
                          '@rccmediard', '@n16noticias', '@lospueblistas']


# Funcion para formatear el alcance
def format_reach(number):
    if pd.isna(number):
        return number
    else:
        return f"{int(number):,}"

# CARGA DEL ARCHIVO CSV A ANALIZAR
file_path = input("Ingrese la ruta de su archivo: ")
df = pd.read_csv(file_path, encoding='utf-16', sep='\t')

# DEFINICIÓN DE LAS COLUMNAS DEL DATAFRAME QUE NO SE VAN A USAR, POR LO QUE DEBEN SER BORRADAS
columns_to_delete = [
    'Opening Text', 'Subregion', 'Desktop Reach', 'Mobile Reach',
    'Twitter Social Echo', 'Facebook Social Echo', 'Reddit Social Echo',
    'National Viewership', 'AVE', 'State', 'City',
    'Social Echo Total', 'Editorial Echo', 'Views', 'Estimated Views',
    'Likes', 'Replies', 'Retweets', 'Comments', 'Shares', 'Reactions',
    'Threads', 'Is Verified'
]

# CREACIÓN DE UNA COPIA DEL DATAFRAME ORIGINAL, PARA REALIZAR LOS CAMBIOS EN ESA COPIA Y SE PROCEDE A BORRAR LAS COLUMNAS INDICADAS EN columns_to_delete
df_cleaned = df.copy()
df_cleaned = df_cleaned.drop(columns_to_delete, axis=1, errors='ignore')

# FUNCIÓN QUE ARREGLA LOS VALORES QUE VAN EN LA COLUMNA 'HIT SENTENCE', DEFINE LOS VALORES QUE PERTENECEN A REDES SOCIALES, POR LO QUE NO HAY QUE DUPLICAR EL VALOR DE LA COLUMNA 'HEADLINE' A SU COLUMNA 'HIT SENTENCE' 
df_cleaned['Hit Sentence'] = df_cleaned['Headline'].where(~df_cleaned['Headline'].isna(), df_cleaned['Hit Sentence'])
exclude_sources = ['Blogs', 'Twitter', 'Youtube', 'Instagram', 'Facebook', 'Pinterest', 'Reddit', 'TikTok', 'Twitch']
mask = ~df_cleaned['Source'].isin(exclude_sources)
df_cleaned.loc[mask, 'Influencer'] = df_cleaned.loc[mask, 'Source']

# DEFINE LOS VALORES DE LA COLUMNA 'SOURCE' QUE VAN A SER CATEGORIZADOS COMO REDES SOCIALES EN LA COLUMNA 'PLATAFORMA' Y EL RESTO SE LE ASIGNA EL VALOR PRENSA DIGITAL EN LA COLUMNA 'PLATAFORMA'
social_network_sources = {
    'Twitter': 'Redes Sociales',
    'Youtube': 'Redes Sociales',
    'Instagram': 'Redes Sociales',
    'Facebook': 'Redes Sociales',
    'Pinterest': 'Redes Sociales',
    'Reddit': 'Redes Sociales',
    'TikTok': 'Redes Sociales',
    'Twitch': 'Redes Sociales',
}
df_cleaned['Plataforma'] = 'Prensa Digital'
def categorize_platform(source):
  return social_network_sources.get(source, 'Prensa Digital')
df_cleaned['Plataforma'] = df_cleaned['Source'].apply(categorize_platform)

# SE ENCARGA DE QUE LAS FILAS QUE TENGAN Facebook EN LA COLUMNA 'SOURCE' SEAN MODIFICADAS EN SU COLUMNA 'INFLUENCER' EN CASO DE QUE LA COLUMNA 'REACH' SEA 0, PARA SABER QUE ES UN COMENTARIO DENTRO DE UNA PUBLICACIÓN.
def update_influencer(row):
    if row['Source'] == 'Facebook' and row['Reach'] == 0:
        return "Comment on " + row['Influencer']
    else:
        return row['Influencer']
df_cleaned['Influencer'] = df_cleaned.apply(update_influencer, axis=1)

# SI LA COLUMNA 'SENTIMENT' TIENE COMO VALOR Unknown O ESTÁ VACÍA SE LE PONE SENTIMIENTO NEUTRAL, DEBIDO A QUE LAS 3 OPCIONES DE SENTIMIENTO QUE NOS INTERESA ES (POSITIVE, NEGATIVE O NEUTRAL)
def update_sentiment(row):
  if row['Sentiment'] == "Unknown" or pd.isna(row['Sentiment']):
    return "Neutral"
  else:
    return row['Sentiment']
df_cleaned['Sentiment'] = df_cleaned.apply(update_sentiment, axis=1)

# OTRA FUNCIÓN QUE SE ENCARGA DE CLASIFICAR BIEN LA COLUMNA 'SENTIMENT' EN ESTE CASO PONE NEUTRAL TODAS LAS MENCIONES QUE HAYAN SIDO CLASIFICADAS COMO PRENSA DIGITAL EN LA COLUMNA 'PLATAFORMA' O QUE EL SOURCE SEA YOUTUBE
def filtrar_sentimientos(df):
    mask_prensa_blogs = (df['Influencer'].isin(social_networks_prensa)) | (df['Plataforma'] == 'Prensa Digital') | (df['Source'] == 'Youtube')

    df['Sentiment'] = np.where(
        mask_prensa_blogs, "Neutral", df['Sentiment'].where(df['Sentiment'].isin(["Positive", "Negative", "Neutral"]), "Neutral")
    )
    return df
df_cleaned = filtrar_sentimientos(df_cleaned)

# SE CALCULA EL TOTAL DE MENCIONES (total_mentions), CONTANDO CUANTAS FILAS TIENE EL DATAFRAME (ESTE VALOR DEBE SER RETORNADO POR LA FUNCION A CREAR), SE CONTABILIZA LA CANTIDAD DE AUTORES UNICOS (count_of_authors), ESTO SE CALCULA CONTANDO LA CANTIDAD DE VALORES UNICOS EN LA COLUMNA 'INFLUENCER' (DEBE SER RETORNADO POR LA FUNCIÓN A CREAR) Y SE CALCULA EL ALCANCE ESTIMADO (estimated_reach) ESTE SE CALCULA AGRUPANDO EL DATAFRAME POR 'INFLUENCER', Y SE TOMA EL MAX DE LA COLUMNA 'REACH' DE CADA INFLUENCER Y SE SUMA EL MAXIMO REACH DE CADA INFLUENCER PARA SABER EL ALCANCE TOTAL ESTIMADO, ANTES DE RETORNAR ESTE VALOR SE LE DEBE PASAR LA FUNCIÓN format_number(number) LA CUAL RECIBE UN NUMERO COMO PARAMETRO Y LO FORMATEA PARA QUE SE VEA EN MILLONES (M) O MILES (K) SI ES DEMASIADO GRANDE (ESTE VALOR DEBE SER RETORNADO POR LA FUNCIÓN A CREAR)
# Total ed Menciones
total_mentions = len(df_cleaned)
# Conteo de Autores
count_of_authors = df_cleaned['Influencer'].nunique()
# Alcance estimado (suma de el max de alcance de cada Influencer)
influencer_groups = df_cleaned.groupby('Influencer')['Reach']
estimated_reach = influencer_groups.max().sum()
def format_number(number):
  """Formats a number to display as millions (M) or thousands (k)"""
  if number >= 1000000:
    return f"{number / 1000000:.1f}M"
  elif number >= 1000:
    return f"{number / 1000:.1f}k"
  else:
    return number
formatted_estimated_reach = format_number(estimated_reach)
# Print de los resultados
print("Total Of Mentions:", total_mentions)
print("Count of Authors:", count_of_authors)
print("Estimated Reach:", formatted_estimated_reach)

# ESTA FUNCIÓN DEBE REALIZAR UN GRAFICO Y GUARDARLO EN LA CARPETA 'scratch', SIN NECESIDAD DE MOSTRARLO.
# Columnas del DataFrame
date_column = 'Alternate Date Format'
time_column = 'Time'
# Función para extraer la fecha en formato 'dd-mmm-yy'
def extract_date(date_str):
    return pd.to_datetime(date_str, format='%d-%b-%y').date()
# Función para extraer solo la hora en formato 'hh AM/PM'
def extract_hour(time_str):
    return pd.to_datetime(time_str, format='%I:%M %p').strftime('%I %p')
# Creación de columnas de fecha y hora
df_cleaned['date'] = df_cleaned[date_column].apply(extract_date)
df_cleaned['hour'] = df_cleaned[time_column].apply(extract_hour)
# Agrupamos por fecha y hora
df_grouped = df_cleaned.groupby(['date', 'hour']).size().reset_index(name='count')
# Convertimos la combinación de fecha y hora a un formato datetime para el gráfico
df_grouped['datetime'] = pd.to_datetime(df_grouped['date'].astype(str) + ' ' + df_grouped['hour'])
# Ordenamos por la columna datetime para un gráfico ordenado cronológicamente
df_grouped = df_grouped.sort_values('datetime')
# Creación del gráfico
fig, ax = plt.subplots(figsize=(13, 6))
ax.plot(df_grouped['datetime'], df_grouped['count'], linewidth=2, color='steelblue')
# Estilización del gráfico
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
# Configuración del formato de fecha y hora en el eje X
ax.xaxis.set_major_locator(mdates.HourLocator(interval=1))
ax.xaxis.set_major_formatter(mdates.DateFormatter('%d-%b %I %p'))
plt.xticks(rotation=45, ha='right')
# Etiquetas y título opcionales
ax.set_xlabel('Fecha y Hora')
ax.set_ylabel('Cantidad de Menciones')
ax.set_title('Evolución de Menciones por Hora')
plt.tight_layout()
plt.savefig('convEvolution.png', transparent=True)
plt.show()

# ESTA FUNCIÓN DEBE GENERAR UN GRÁFICO Y GUARDARLO EN LA CARPETA 'scratch'
sentiment_counts = df_cleaned[df_cleaned['Sentiment'] != 'Not Rated']['Sentiment'].value_counts()
sentiment_colors = {
    'Negative': '#ff0000',
    'Positive': '#00b050',
    'Neutral': '#BFBFBF'
}
labels = sentiment_counts.index.to_list()
sizes = sentiment_counts.to_list()
plt.figure(figsize=(10, 10))
colors = [sentiment_colors.get(label, 'lightgray') for label in labels]
plt.pie(
    sizes,
    autopct="%1.1f%%",
    colors=colors,
    textprops=dict(backgroundcolor='w', fontsize=14, fontweight='bold'),
    startangle=140
)
plt.axis('equal')
plt.savefig('sentiment_pie_chart.png', transparent=True)
plt.show()

# ESTA FUNCION USA LA COLUMNA 'PLATAFORMA' PARA CONTAR CUÁNTAS MENCIONES HAY EN EL CASO DE "redes sociales" Y CUÁNTAS EN EL CASO DE "prensa digital". DEBE RETORNAR AMBOS VALORES COMO VARIABLES, NO ES NECESARIO QUE RETORNE EL DATAFRAME NI EL alcance máximo
def distribucion_plataforma(df):
    platform_counts = df['Plataforma'].value_counts()
    posts_per_platform = df.groupby('Plataforma')['Date'].count()
    max_reach_per_platform = df.groupby('Plataforma')['Reach'].max()
    platform_distribution = pd.DataFrame({
        'Plataforma': platform_counts.index,
        'Publicaciones': platform_counts.values,
        'Alcance Máximo': max_reach_per_platform.values
    })
    platform_distribution['Alcance Máximo'] = platform_distribution['Alcance Máximo'].apply(format_number)
    return platform_distribution
platform_distribution_df = distribucion_plataforma(df_cleaned)
print(platform_distribution_df)

# Estas 3 funciones que generan dataframes estám correctas, no necesitan modificación
def top_influencers_prensa_digital(df_cleaned):
    filter_prensa_digital = df_cleaned['Plataforma'] == "Prensa Digital"
    df_prensa = df_cleaned[filter_prensa_digital]
    df_prensa_grouped = df_prensa.groupby('Influencer')[['Reach']].agg(['count', 'max'])
    df_prensa_grouped.columns = ['Posts', 'Max Reach']
    df_prensa_grouped = df_prensa_grouped.sort_values(by='Posts', ascending=False).head(20)
    df_prensa_grouped['Max Reach'] = df_prensa_grouped['Max Reach'].apply(format_reach)
    return df_prensa_grouped
def top_influencers_redes_sociales_by_posts(df_cleaned):
    filter_redes_sociales = df_cleaned['Plataforma'] == "Redes Sociales"
    df_redes = df_cleaned[filter_redes_sociales]
    df_redes_grouped = (
        df_redes.groupby('Influencer')[['Reach', 'Source']]
        .agg(Posts=('Reach', 'count'), Max_Reach=('Reach', 'max'), Source=('Source', 'first'))
    )
    df_redes_grouped['Max_Reach'] = df_redes_grouped['Max_Reach'].apply(format_reach)
    df_redes_grouped = df_redes_grouped.sort_values(by='Posts', ascending=False).head(20)
    return df_redes_grouped[['Posts', 'Max_Reach', 'Source']]
def top_influencers_redes_sociales_by_reach(df_cleaned):
    filter_redes_sociales = df_cleaned['Plataforma'] == "Redes Sociales"
    df_redes = df_cleaned[filter_redes_sociales]
    df_redes_grouped = df_redes.groupby('Influencer')[['Reach']].agg(['count', 'max'])
    df_redes_grouped.columns = ['Posts', 'Max Reach']
    df_redes_grouped = df_redes_grouped.sort_values(by='Max Reach', ascending=False).head(20)
    df_redes_grouped['Max Reach'] = df_redes_grouped['Max Reach'].apply(format_reach)
    return df_redes_grouped[['Max Reach', 'Posts']]


# ESTA FUNCION EXTRAE EL HIT SENTENCE DE LAS 5 ROWS ORDENADAS POR LA COLUMNA 'REACH' QUE SU VALOR EN LA COLUMNA 'PLATAFORMA' SEA "Prensa Digital", ESTA FUNCIÓN DEBE RETORNAR UN ARREGLO O LISTA QUE CONTENGA LAS 5 HIT SENTENCE DE LAS NOTICIAS
df_prensa = df_cleaned[df_cleaned['Plataforma'] == "Prensa Digital"]
top_influencers = df_prensa.sort_values(by=['Reach'], ascending=False) \
                             .groupby('Influencer')['Reach'].max() \
                             .head(10).index
top_5_hit_sentences = df_prensa[df_prensa['Influencer'].isin(top_influencers)]['Hit Sentence']
for sentence in top_5_hit_sentences:
    wrapper = textwrap.TextWrapper(width=100)
    wrapped_text = wrapper.wrap(text=sentence)
    for line in wrapped_text:
        print(line)

# ESTA FUNCIÓN SE ENCARGA DE GUARDAR LOS CAMBIOS REALIZADOS AL CSV EN UN ARCHIVO CSV NUEVO, ESTO PARA PODER HACER CIERTOS CAMBIOS O VERIFICAR DATOS EN CASO DE QUE SEA NECESARIO
base_filename = os.path.basename(file_path).split()[0]
base_filename = base_filename.split('.')[0]
output_filename = f"{base_filename}_(resultado).csv"
with open(output_filename, 'w', encoding='utf-16', newline='') as f:
    df_cleaned.to_csv(f, index=False, sep='\t')
print(f"CSV data saved to: {output_filename}")