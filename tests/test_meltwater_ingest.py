import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services import meltwater_ingest

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


def _open_all():
    """Returns file-like tuples (filename, bytes) for load_widget_files()."""
    files = []
    for name in FIXTURE_FILES:
        with open(os.path.join(FIXTURES_DIR, name), 'rb') as f:
            files.append((name, f.read()))
    return files


class TestMeltwaterIngest(unittest.TestCase):

    def test_load_widget_files_recognizes_all_widgets(self):
        widgets, warnings = meltwater_ingest.load_widget_files(_open_all())
        self.assertEqual(len(widgets), len(FIXTURE_FILES))
        self.assertEqual(warnings, [])  # every widget loaded, nothing to complain about

    def test_missing_widget_produces_warning_not_error(self):
        files = _open_all()[:5]  # only the first 5 widgets
        widgets, warnings = meltwater_ingest.load_widget_files(files)
        self.assertEqual(len(widgets), 5)
        self.assertTrue(any('No se cargó' in w for w in warnings))

    def test_unrecognized_sheet_is_skipped_with_warning(self):
        files = _open_all()[:1]
        widgets, warnings = meltwater_ingest.load_widget_files(files)
        self.assertEqual(len(widgets), 1)

    def test_parse_mentions_trend(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_mentions_trend(widgets['mentions_trend'])
        self.assertEqual(len(parsed['labels']), 7)
        self.assertEqual(len(parsed['current']), 7)
        self.assertEqual(len(parsed['previous']), 7)
        self.assertEqual(parsed['current'][0], 2158)

    def test_parse_reach_trend(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_reach_trend(widgets['reach_trend'])
        self.assertEqual(parsed['current'][0], 1258670062)

    def test_parse_sentiment(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_sentiment(widgets['sentiment'])
        # `key` conserva la etiqueta original de Meltwater...
        keys = {s['key'] for s in parsed}
        self.assertEqual(keys, {'Neutral', 'Negative', 'Positive', 'Not Rated'})
        # ...y `label` es la traduccion que ve el usuario.
        labels = {s['label'] for s in parsed}
        self.assertEqual(labels, {'Neutral', 'Negativo', 'Positivo', 'Sin calificar'})

    def test_parse_emotions_translated(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_emotions(widgets['emotions'])
        by_key = {e['key']: e['label'] for e in parsed}
        self.assertEqual(by_key.get('Anger'), 'Enojo')
        self.assertEqual(by_key.get('Joy'), 'Alegría')

    def test_parse_sentiment_by_source_translated(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_sentiment_by_source(widgets['sentiment_by_source'])
        sources = {s['source'] for s in parsed}
        self.assertIn('Noticias digitales', sources)  # 'News - Online' traducido
        self.assertIn('X', sources)                   # nombre propio, sin tocar

    def test_parse_keywords_splits_sections(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_keywords(widgets['keywords'])
        self.assertGreater(len(parsed['keywords']), 0)
        self.assertGreater(len(parsed['locations']), 0)
        self.assertIn('keyword', parsed['keywords'][0])
        self.assertIn('location', parsed['locations'][0])

    def test_parse_mentions_by_source(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_mentions_by_source(widgets['mentions_by_source'])
        self.assertIn('News - Online', parsed['series'])
        self.assertEqual(len(parsed['labels']), 7)

    def test_parse_top_authors(self):
        widgets, _ = meltwater_ingest.load_widget_files(_open_all())
        parsed = meltwater_ingest.parse_top_authors(widgets['top_authors'])
        self.assertGreater(len(parsed), 0)
        self.assertIn('author', parsed[0])
        self.assertIn('followers', parsed[0])



class TestSlotValidation(unittest.TestCase):
    """Carga por casillas nombradas: el usuario dice qué es cada archivo."""

    def _bytes(self, name):
        with open(os.path.join(FIXTURES_DIR, name), 'rb') as f:
            return f.read()

    def test_slot_fields_cover_every_widget(self):
        campos = meltwater_ingest.slot_fields()
        self.assertEqual(len(campos), len(meltwater_ingest.WIDGET_LABELS))
        for c in campos:
            self.assertTrue(c['field'].startswith('widget_'))
            self.assertTrue(c['sheet'])

    def test_correct_file_in_correct_slot(self):
        df, error = meltwater_ingest.validate_widget(
            'mentions_trend', self._bytes(FIXTURE_FILES[0]), FIXTURE_FILES[0])
        self.assertIsNone(error)
        self.assertIsNotNone(df)

    def test_wrong_slot_names_both_widgets(self):
        """El error debe decir qué es el archivo y dónde va, no solo 'inválido'."""
        df, error = meltwater_ingest.validate_widget(
            'mentions_trend', self._bytes('01.Alcance.xlsx'), '01.Alcance.xlsx')
        self.assertIsNone(df)
        self.assertIn('Alcance', error)                       # lo que realmente es
        self.assertIn('Evolución y cantidad de menciones', error)  # donde se cargó

    def test_non_excel_file_is_rejected(self):
        df, error = meltwater_ingest.validate_widget(
            'sentiment', b'esto no es un excel', 'notas.txt')
        self.assertIsNone(df)
        self.assertIn('Excel', error)

    def test_load_slots_reports_errors_and_missing(self):
        slots = {
            'mentions_trend': (FIXTURE_FILES[0], self._bytes(FIXTURE_FILES[0])),
            'sentiment': ('01.Alcance.xlsx', self._bytes('01.Alcance.xlsx')),  # casilla equivocada
        }
        widgets, errores, warnings = meltwater_ingest.load_widget_slots(slots)

        self.assertIn('mentions_trend', widgets)
        self.assertIn('sentiment', errores)
        self.assertNotIn('sentiment', widgets)
        # Las casillas vacías son avisos, no errores: el reporte se genera igual.
        self.assertTrue(any('Hashtags más usados' in w for w in warnings))

    def test_all_slots_valid(self):
        slots = {}
        for key, name in zip(
            ['mentions_trend', 'reach_trend', 'clusters', 'keywords', 'sentiment',
             'mentions_by_source', 'sentiment_by_source', 'hashtags', 'emotions', 'top_authors'],
            FIXTURE_FILES
        ):
            slots[key] = (name, self._bytes(name))

        widgets, errores, warnings = meltwater_ingest.load_widget_slots(slots)
        self.assertEqual(errores, {})
        self.assertEqual(warnings, [])
        self.assertEqual(len(widgets), len(FIXTURE_FILES))


class TestBulkLoading(unittest.TestCase):
    """Modo por defecto: todo junto, repartido por nombre de hoja."""

    def test_bulk_recognizes_every_widget(self):
        widgets, detected, problems, warnings = meltwater_ingest.load_widget_bulk(_open_all())
        self.assertEqual(len(widgets), len(FIXTURE_FILES))
        self.assertEqual(problems, [])
        self.assertEqual(warnings, [])
        # El nombre del archivo da igual: lo que manda es la hoja.
        self.assertEqual(detected['reach_trend'], '01.Alcance.xlsx')

    def test_bulk_order_does_not_matter(self):
        revuelto = list(reversed(_open_all()))
        widgets, detected, problems, _ = meltwater_ingest.load_widget_bulk(revuelto)
        self.assertEqual(len(widgets), len(FIXTURE_FILES))
        self.assertEqual(problems, [])

    def test_bulk_reports_unrecognized_file(self):
        archivos = _open_all()[:2] + [('notas.txt', b'no soy un excel')]
        widgets, _, problems, _ = meltwater_ingest.load_widget_bulk(archivos)
        self.assertEqual(len(widgets), 2)
        self.assertEqual(len(problems), 1)
        self.assertIn('notas.txt', problems[0])

    def test_bulk_reports_duplicate_widget(self):
        dup = _open_all()[:1] * 2
        widgets, _, problems, _ = meltwater_ingest.load_widget_bulk(dup)
        self.assertEqual(len(widgets), 1)
        self.assertTrue(any('ya había uno cargado' in p for p in problems))

    def test_bulk_partial_upload_warns_about_missing(self):
        widgets, _, problems, warnings = meltwater_ingest.load_widget_bulk(_open_all()[:3])
        self.assertEqual(len(widgets), 3)
        self.assertEqual(problems, [])
        self.assertEqual(len(warnings), len(FIXTURE_FILES) - 3)

if __name__ == '__main__':
    unittest.main()
