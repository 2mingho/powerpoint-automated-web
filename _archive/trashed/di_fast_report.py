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

social_networks_prensa = ['@EdeesteRD','@edeesterd', "edenorterd", "edesurrd", '@precisionportal', 'panoramatv_',
                          '@mananerord', '@noticiaspimentl', '@MIC_RD',"siegobrd", '@soldelamananard', '@drmariolama', '@labazucaenlared',
                          '@eldia_do', '@diariosaluddo', '@noticiasrnn', '@periodicohoy', '@telemicrohd', '@precisionportal', '@telenoticiasrd',
                          '@sin24horas', 'sin24horas', '@diariolibre', 'diariolibre', '@cdn37', 'cdn.com.do',
                          '@listindiario', 'listindiario', 'bavaronews', '@acentodiario', '@anoticias7', '@z101digital',
                          'z101digital', 'revista110', 'rcavada', '@rcavada', 'robertocavada', 'ndigital', 'bavarodigital',
                          '@elnuevodiariord',  '@acentodiario', '@deultimominutomedia', '@aeromundo_ggomez', '@cachichatv',
                          '@remolachanews','@ntelemicro5','@megadiariord', '@noticiasmn', '@eldemocratard', '@elpregonerord',
                          '@infoturdom', '@comunidadojala', '@panorama_do', '@panoramard1', '@invertix', '@derechoasaberlo',
                          '@rccmediard', '@n16noticias', '@lospueblistas']

file_path = input("Ingrese la ruta de su archivo: ")
df = pd.read_csv(file_path, encoding='utf-16', sep='\t')

#Lista de columnas para borrar
columns_to_delete = ['Opening Text', 'Subregion', 'Desktop Reach', 'Mobile Reach', 'Twitter Social Echo', 'Facebook Social Echo', 'Reddit Social Echo', 'National Viewership', 'AVE', 'State', 'City', 'Social Echo Total', 'Editorial Echo', 'Views', 'Estimated Views', 'Likes', 'Replies', 'Retweets', 'Comments', 'Shares', 'Reactions', 'Threads', 'Is Verified']
df_cleaned = df.copy()
df_cleaned = df_cleaned.drop(columns_to_delete, axis=1, errors='ignore')

df_cleaned['Hit Sentence'] = df_cleaned['Headline'].where(~df_cleaned['Headline'].isna(), df_cleaned['Hit Sentence'])
exclude_sources = ['Blogs', 'Twitter', 'Youtube', 'Instagram', 'Facebook', 'Pinterest', 'Reddit', 'TikTok', 'Twitch']
mask = ~df_cleaned['Source'].isin(exclude_sources)
df_cleaned.loc[mask, 'Influencer'] = df_cleaned.loc[mask, 'Source']

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

def update_influencer(row):
    if row['Source'] == 'Facebook' and row['Reach'] == 0:
        return "Comment on " + row['Influencer']
    else:
        return row['Influencer']

def update_sentiment(row):
  if row['Sentiment'] == "Unknown" or pd.isna(row['Sentiment']):
    return "Neutral"
  else:
    return row['Sentiment']

df_cleaned['Influencer'] = df_cleaned.apply(update_influencer, axis=1)
df_cleaned['Sentiment'] = df_cleaned.apply(update_sentiment, axis=1)

def filtrar_sentimientos(df):
    mask_prensa_blogs = (df['Influencer'].isin(social_networks_prensa)) | (df['Plataforma'] == 'Prensa Digital') | (df['Source'] == 'Youtube')

    df['Sentiment'] = np.where(
        mask_prensa_blogs, "Neutral", df['Sentiment'].where(df['Sentiment'].isin(["Positive", "Negative", "Neutral"]), "Neutral")
    )
    return df

df_cleaned = filtrar_sentimientos(df_cleaned)

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
print("Total Of Mentions:", total_mentions) # Colocar en slide2, NUMB_MENTIONS
print("Count of Authors:", count_of_authors) # Colocar en slide2, NUMB_ACTORS
print("Estimated Reach:", formatted_estimated_reach) # Colocar en slide2, EST_REACH


date_column = 'Date'
time_column = 'Time'

def extract_date(datetime_str):
    try:
        return pd.to_datetime(datetime_str, format='%d-%b-%Y').date()
    except ValueError:
        return pd.to_datetime(datetime_str.split()[0], format='%d-%b-%Y').date()

def extract_hour(datetime_str):
    try:
        return pd.to_datetime(datetime_str, format='%d-%b-%Y %I:%M%p').strftime('%I %p')
    except ValueError:
        return pd.to_datetime(datetime_str.strip(), format='%I:%M %p').strftime('%I %p')

df_cleaned['date'] = df_cleaned[date_column].apply(extract_date)
df_cleaned['hour'] = df_cleaned[date_column] + ' ' + df_cleaned[time_column].apply(extract_hour)

def plot_by_date_or_hour(df, use_hours=True):
    if use_hours:
        df_grouped = df.groupby(['date', 'hour']).size().reset_index(name='count')
    else:
        df_grouped = df.groupby(['date']).size().reset_index(name='count')

    dates = df_grouped['date']
    count = df_grouped['count']

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(dates, count, linewidth=4, color='orange')

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%d-%b-%Y'))
    plt.xticks(rotation=45, ha='right')

    plt.tight_layout()
    plt.savefig('convEvolution.png', transparent=True)

# Usage:
plot_by_date_or_hour(df_cleaned, use_hours=False) # Plot by date only
# TO PUT IN SLIDE2 AS PNG

sentiment_counts = df_cleaned[df_cleaned['Sentiment'] != 'Not Rated']['Sentiment'].value_counts()

sentiment_colors = {
    'Negative': '#ff0000',
    'Positive': '#00b050',
    'Neutral': '#BFBFBF'
}

labels = sentiment_counts.index.to_list()
sizes = sentiment_counts.to_list()

plt.figure(figsize=(7, 7))
colors = [sentiment_colors.get(label, 'lightgray') for label in labels]

plt.pie(
    sizes,
    autopct="%1.1f%%",
    colors=colors,
    textprops=dict(backgroundcolor='w', fontsize=14, fontweight='bold'),
    startangle=140
)

plt.axis('equal')
plt.savefig('sentiment_pie_chart.png', transparent=True) #TO PUT ON SLIDE4 AS PNG

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
#EXTRAER DISTRIBUCION POR PLATAFORMA EN VARIABLES Y LA CANTIDAD DE PUBLICACIONES DE PRENSA DIGITAL DEBE IR EN EL SLIDE5 REEMPLAZANDO NUMB_PRENSA. LA CANTIDAD DE PUBLICACIONES DE REDES SOCIALES DEBE IR EN EL SLIDE6 REEMPLAZANDO NUMB_REDES.

filter_prensa_digital = df_cleaned['Plataforma'] == "Prensa Digital"
filter_redes_sociales = df_cleaned['Plataforma'] == "Redes Sociales"

def format_reach(number):
    if pd.isna(number):
        return number
    else:
        return f"{int(number):,}"

# print("\n------------------------\n")  # Divider between table

print("Prensa Digital (By Posts)")
df_prensa = df_cleaned[filter_prensa_digital]
df_prensa_grouped = df_prensa.groupby('Influencer')[['Reach']].agg(['count', 'max'])
df_prensa_grouped.columns = ['Posts', 'Max Reach']

df_prensa_grouped = df_prensa_grouped.sort_values(by='Posts', ascending=False).head(20)
df_prensa_grouped['Max Reach'] = df_prensa_grouped['Max Reach'].apply(format_reach)
print(df_prensa_grouped)
# AGREGAR df_prensa_grouped EN EL SLIDE5 COMO TABLA

# print("\n------------------------\n")  # Divider between tables

print("Redes Sociales (By Posts)")
df_redes = df_cleaned[filter_redes_sociales]
df_redes_grouped = (
    df_redes.groupby('Influencer')[['Reach', 'Source']]
    .agg(Posts=('Reach', 'count'), Max_Reach=('Reach', 'max'), Source=('Source', 'first'))
)
df_redes_grouped['Max_Reach'] = df_redes_grouped['Max_Reach'].apply(format_reach)
df_redes_grouped = df_redes_grouped.sort_values(by='Posts', ascending=False).head(20)
print(df_redes_grouped[['Posts', 'Max_Reach', 'Source']])
# AGREGAR TABLA EN EN SLIDE6 COMO TABLA (UBICADO EN LA MITAD IZQUIERDA DE LA PANTALLA)

# print("\n------------------------\n")  # Divider between tables

print("Redes Sociales (By Reach)")
df_redes = df_cleaned[filter_redes_sociales]
df_redes_grouped = df_redes.groupby('Influencer')[['Reach']].agg(['count', 'max'])
df_redes_grouped.columns = ['Posts', 'Max Reach']
df_redes_grouped = df_redes_grouped.sort_values(by='Max Reach', ascending=False).head(20)
df_redes_grouped['Max Reach'] = df_redes_grouped['Max Reach'].apply(format_reach)
df_redes_grouped = df_redes_grouped[['Max Reach', 'Posts']]
print(df_redes_grouped)
# AGREGAR TABLA EN EN SLIDE6 COMO TABLA (UBICADO EN LA MITAD DERECHA DE LA PANTALLA)

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
# MODIFICAR ESTA FUNCION PARA QUE COLOQUE LAS 5 PRIMERAS TOP NEWS EN EL SLIDE3 REEMPLAZANDO TOP_NEWS

base_filename = os.path.basename(file_path).split()[0]
base_filename = base_filename.split('.')[0]
output_filename = f"{base_filename}_(resultado).csv"
with open(output_filename, 'w', encoding='utf-16', newline='') as f:
    df_cleaned.to_csv(f, index=False, sep='\t')
print(f"CSV data saved to: {output_filename}")
#GUARDAR CSV EN LA CARPETA SCRATCH Y COLOCAR EL NOMBRE DEL ARCHIVO EN EL SLIDE1 REEMPLAZANDO REPORT_CLIENT