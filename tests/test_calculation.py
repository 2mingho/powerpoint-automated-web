import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services import calculation, meltwater_ingest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures', 'meltwater_widgets')

FIXTURE_FILES = [
    '00.Evolucion_y_cantidad_de_menciones.xlsx',
    '01.Alcance.xlsx',
    '02.AI-Powered_Clusters.xlsx',
    '03.Keywords.xlsx',
    '04.Sentimiento.xlsx',
    '05.Menciones_por_source.xlsx',
    '06.Sentiment_By_Source_Type.xlsx',
    '07.Top_Hashtags.xlsx',
    '08.Emotional_Comparison.xlsx',
    '09.Top_X_Authors.xlsx',
]


def _build_full_context(report_title="Cliente Real"):
    files = []
    for name in FIXTURE_FILES:
        with open(os.path.join(FIXTURES_DIR, name), 'rb') as f:
            files.append((name, f.read()))
    widgets, warnings = meltwater_ingest.load_widget_files(files)
    parsed = meltwater_ingest.parse_widgets(widgets)
    return calculation.create_report_context_from_widgets(parsed, report_title=report_title, warnings=warnings)


class TestCreateReportContextFromWidgets(unittest.TestCase):

    def test_context_structure_and_kpis(self):
        context = _build_full_context()

        # Top-level shape
        for key in ('meta', 'kpis', 'charts', 'content', 'narrative', 'warnings'):
            self.assertIn(key, context)

        self.assertEqual(context['meta']['client_name'], "Cliente Real")

        # Menciones: suma de la columna "Mentions" del fixture 00
        # (2158+3521+6398+5951+4615+6811+3692)
        self.assertEqual(context['kpis']['total_mentions'], 33146)
        self.assertIsInstance(context['kpis']['mentions_change_pct'], float)

        # Alcance: suma de la columna "Reach" del fixture 01
        self.assertGreater(context['kpis']['estimated_reach'], 0)

        # Prensa vs redes, derivado de "Mentions Trend by Source Type"
        self.assertGreater(context['kpis']['mentions_prensa'], 0)
        self.assertGreater(context['kpis']['mentions_redes'], 0)

    def test_charts_present(self):
        context = _build_full_context()
        charts = context['charts']
        self.assertEqual(len(charts['evolution']['labels']), 7)
        self.assertEqual(len(charts['reach_evolution']['labels']), 7)
        self.assertTrue(len(charts['sentiment']) > 0)
        self.assertTrue(len(charts['sentiment_by_source']) > 0)
        self.assertTrue(len(charts['emotions']) > 0)

    def test_content_present(self):
        context = _build_full_context()
        content = context['content']
        self.assertTrue(len(content['clusters']) > 0)
        self.assertTrue(len(content['keywords']) > 0)
        self.assertTrue(len(content['hashtags']) > 0)
        self.assertTrue(len(content['top_authors']) > 0)

    def test_narrative_is_generated(self):
        context = _build_full_context()
        narrative = context['narrative']
        self.assertTrue(narrative['overview'])
        # La narrativa usa formato español (33.146), así que se comparan dígitos.
        solo_digitos = ''.join(c for c in narrative['overview'] if c.isdigit())
        self.assertIn(str(context['kpis']['total_mentions']), solo_digitos)

    def test_narrative_number_format(self):
        """Coma para miles, punto para decimales (convención dominicana)."""
        context = _build_full_context()
        overview = context['narrative']['overview']
        self.assertIn('33,146', overview)   # coma como separador de miles
        self.assertIn('13.6', overview)     # punto como separador decimal
        self.assertNotIn('33.146', overview)

    def test_missing_widgets_do_not_crash(self):
        """A partial upload (missing widgets) should still build a valid context."""
        files = []
        for name in FIXTURE_FILES[:2]:  # only mentions_trend + reach_trend
            with open(os.path.join(FIXTURES_DIR, name), 'rb') as f:
                files.append((name, f.read()))
        widgets, warnings = meltwater_ingest.load_widget_files(files)
        parsed = meltwater_ingest.parse_widgets(widgets)
        context = calculation.create_report_context_from_widgets(parsed, report_title="Parcial", warnings=warnings)

        self.assertGreater(len(context['warnings']), 0)
        self.assertEqual(context['content']['clusters'], [])
        self.assertGreaterEqual(context['kpis']['total_mentions'], 0)


if __name__ == '__main__':
    unittest.main()
