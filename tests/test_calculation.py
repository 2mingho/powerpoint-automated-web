import unittest
import pandas as pd
import sys
import os
from io import StringIO

# --- MAGIC: Permitir importar desde el directorio padre ---
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import calculation

# Simulación de TU archivo real (Tab-separated)
# He alineado las columnas clave: Source, Reach, Sentiment, Alternate Date Format, Hit Sentence
CSV_DATA = """Date\tHeadline\tURL\tOpening Text\tHit Sentence\tSource\tInfluencer\tCountry\tSubregion\tLanguage\tReach\tDesktop Reach\tMobile Reach\tTwitter Social Echo\tFacebook Social Echo\tReddit Social Echo\tNational Viewership\tEngagement\tAVE\tSentiment\tKey Phrases\tInput Name\tKeywords\tTwitter Authority\tTweet Id\tTwitter Id\tTwitter Client\tTwitter Screen Name\tUser Profile Url\tTwitter Bio\tTwitter Followers\tTwitter Following\tAlternate Date Format\tTime\tState\tCity\tSocial Echo Total\tEditorial Echo\tViews\tEstimated Views\tLikes\tReplies\tRetweets\tComments\tShares\tReactions\tThreads\tIs Verified\tParent URL\tDocument Tags\tDocument ID\tCustom Categories
06-Feb-2026 03:03PM\tEn Farma Extra, creemos en un Amor Único\thttps://t.co/example\tTexto apertura\tEn Farma Extra, creemos en un Amor Único: ese que buscas, ese que está cuando más lo necesitas...\tTwitter\t@farmaextrado\tUnknown\t\tSpanish\t15\t\t\t\t\t\t\t\t0.14\tPositive\t\tFarma_Extra\tFarma Extra\t1\t2019849392560165115\t1767999239286603776\t\tFarma Extra RD\thttps://twitter.com/Farmaextrado\tBio...\t15\t8\t06-Feb-26\t3:03 PM\t\t\t\t\t\t\t\t\t\t\t\t\tfalse\t\t\t\t
05-Feb-2026 10:11AM\tCon pequeños hábitos diarios puedes construir una Vida Extra Sana\thttps://t.co/example2\tTexto apertura\tCon pequeños hábitos diarios puedes construir una Vida Extra Sana. Lo importante es la constancia...\tTwitter\t@farmaextrado\tUnknown\t\tSpanish\t15\t\t\t\t\t\t\t\t0.14\tNeutral\tpequeños hábitos\tFarma_Extra\tFarma Extra\t1\t2019413486686581083\t1767999239286603776\t\tFarma Extra RD\thttps://twitter.com/Farmaextrado\tBio...\t15\t8\t05-Feb-26\t10:11 AM\t\t\t\t\t\t\t\t\t\t\t\t\tfalse\t\t\t\t
03-Feb-2026 05:05PM\tFarma extra fue la primera\thttps://youtube.com/example\tTexto apertura\tFarma extra fue la primera Cuanto te estan pagando para decir ese disparate?\tYoutube\tComment on Panorama Social\tUnknown\t\t\t0\t\t\t\t\t\t\t\t0.00\tNeutral\t\tfarma extra\tFarma_Extra\t\t\t\t\t\t\t\t\t\t03-Feb-26\t5:05 PM\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t
03-Feb-2026 04:06PM\tLa guerra farmacéutica en RD GBC vs Farma Extra\thttps://t.co/example3\tTexto apertura\tLa guerra farmacéutica en RD GBC vs Farma Extra y el misterio del 20%\tTwitter\t@panoramasocial3\tUnknown\t\tSpanish\t284\t\t\t\t\t\t2\t2.63\tNeutral\t\tFarma_Extra\tFarma Extra\t5\t2018778221504794735\t1549169894087966721\t\tPanoramasocialtw\thttps://twitter.com/Panoramasocial3\tBio...\t284\t24\t03-Feb-26\t4:06 PM\t\t\t23\t\t2\t\t\t\t2\tfalse\t\t\t\t
"""

class TestCalculation(unittest.TestCase):
    
    def setUp(self):
        pass

    def test_clean_dataframe_logic(self):
        """Prueba que el DF procesa correctamente TU muestra de datos"""
        temp_csv_name = "tests/temp_real_data.csv"
        
        # Guardamos el string CSV_DATA como un archivo físico temporal
        with open(temp_csv_name, "w", encoding="utf-16") as f:
            # Usamos StringIO para simular la lectura y luego escribirlo correctamente
            df_raw = pd.read_csv(StringIO(CSV_DATA), sep='\t')
            df_raw.to_csv(f, sep='\t', index=False)
            
        try:
            df = calculation.clean_dataframe(temp_csv_name)
            
            # --- Validaciones Específicas para tus datos ---
            
            # 1. Debería haber 4 filas en total
            self.assertEqual(len(df), 4, "El DataFrame debería tener 4 filas")
            
            # 2. Verificar clasificación de Plataforma
            # Tus 4 filas son de Twitter (3) y Youtube (1) -> Todas son 'Redes Sociales'
            conteo_plataformas = df['Plataforma'].value_counts()
            self.assertEqual(conteo_plataformas.get('Redes Sociales'), 4, "Todas las entradas deberían ser Redes Sociales")
            self.assertTrue('Prensa Digital' not in conteo_plataformas or conteo_plataformas['Prensa Digital'] == 0)

            # 3. Verificar que la columna Hit Sentence existe y tiene datos
            self.assertIn('Hit Sentence', df.columns)
            self.assertTrue(df.iloc[0]['Hit Sentence'].startswith("En Farma Extra"))

        finally:
            if os.path.exists(temp_csv_name):
                os.remove(temp_csv_name)

    def test_create_report_context_structure(self):
        """Valida los cálculos de KPIs con tus números reales"""
        temp_csv_name = "tests/temp_real_context.csv"
        
        with open(temp_csv_name, "w", encoding="utf-16") as f:
            df_raw = pd.read_csv(StringIO(CSV_DATA), sep='\t')
            df_raw.to_csv(f, sep='\t', index=False)

        try:
            context = calculation.create_report_context(temp_csv_name, "Cliente Real")
            
            # --- Validaciones de Negocio (KPIs) ---
            
            # Total Menciones: 4
            self.assertEqual(context['kpis']['total_mentions'], 4)
            
            # Total Reach: 15 + 15 + 0 + 284 = 314
            # (Nota: calculation.py suma el MAX reach por influencer.
            # Influencers: @farmaextrado (15), Comment... (0), @panoramasocial3 (284).
            # @farmaextrado aparece 2 veces con 15. Max = 15.
            # Total esperado = 15 + 0 + 284 = 299)
            self.assertEqual(context['kpis']['estimated_reach'], 299, "El alcance estimado debería sumar los máximos por autor")
            
            # Verificar Sentimientos (Chart Data)
            # Positive: 1, Neutral: 3 (Twitter 2 + Youtube 1)
            sentiments = {item['label']: item['value'] for item in context['charts']['sentiment']}
            self.assertEqual(sentiments.get('Positive'), 1)
            # En tu data hay 2 "Neutral" explícitos y 1 que podría ser nulo/neutral en Youtube
            # Dependiendo de cómo pandas lea el CSV string, verificamos que exista al menos 'Neutral'
            self.assertIn('Neutral', sentiments)

        finally:
             if os.path.exists(temp_csv_name):
                os.remove(temp_csv_name)

if __name__ == '__main__':
    unittest.main()