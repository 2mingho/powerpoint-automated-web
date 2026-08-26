import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services import calculation, insight_harness, meltwater_ingest

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


def _context():
    files = []
    for name in FIXTURE_FILES:
        with open(os.path.join(FIXTURES_DIR, name), 'rb') as f:
            files.append((name, f.read()))
    widgets, warnings = meltwater_ingest.load_widget_files(files)
    parsed = meltwater_ingest.parse_widgets(widgets)
    # use_ai_insights=False: estos tests inyectan su propio modelo simulado.
    return calculation.create_report_context_from_widgets(
        parsed, report_title='Cliente', warnings=warnings, use_ai_insights=False
    )


def _valid_payload():
    """Una respuesta que solo cita cifras reales del reporte."""
    return {
        'volume_title': 'La conversación baja pero sigue siendo masiva',
        'volume_take': 'Se registraron 33146 menciones, un 13.6% menos que el periodo anterior.',
        'sentiment_title': 'Neutra en la superficie, negativa por debajo',
        'sentiment_take': 'El neutro domina con 23095 menciones frente a 9188 negativas.',
        'by_source_title': 'El enfado se concentra en X',
        'by_source_take': 'X acumula 8276 menciones negativas.',
        'topics_title': 'Un debate parlamentario y una acusación',
        'topics_take': 'El tema principal reúne 67 menciones.',
        'authors_title': 'La prensa regional lleva la conversación',
        'authors_take': 'X aporta 27274 menciones del total.',
        'conclusion_1': 'El volumen cae. Menos menciones que la semana previa.',
        'conclusion_2': 'X es el frente crítico. Ahí se concentra la negatividad.',
        'conclusion_3': 'Dos conversaciones. Avanzan en paralelo.',
    }


def _fake_model(payload):
    def _complete(prompt, temperature=0.4, feature=None):
        return json.dumps(payload)
    return _complete


class TestFactSheet(unittest.TestCase):

    def test_fact_sheet_collects_real_figures(self):
        ctx = _context()
        texto, nums, pcts = insight_harness.build_fact_sheet(ctx)

        self.assertIn('VOLUMEN Y ALCANCE', texto)
        self.assertIn('SENTIMIENTO', texto)
        self.assertIn(33146, nums)          # menciones totales
        self.assertIn(23095, nums)          # neutras
        self.assertIn(13.6, pcts)           # caida frente al periodo anterior

    def test_prompt_embeds_contract_and_slots(self):
        ctx = _context()
        prompt, _, _ = insight_harness.build_prompt(ctx)
        self.assertIn('No inventes NUNCA una cifra', prompt)
        for slot in insight_harness.SLOTS:
            self.assertIn(slot, prompt)


class TestValidation(unittest.TestCase):

    def setUp(self):
        self.ctx = _context()
        _, self.nums, self.pcts = insight_harness.build_fact_sheet(self.ctx)

    def test_accepts_grounded_answer(self):
        ok, motivo = insight_harness.validate(_valid_payload(), self.nums, self.pcts)
        self.assertTrue(ok, motivo)

    def test_rejects_invented_figure(self):
        """El guardarrail central: una cifra que no existe en los datos."""
        payload = _valid_payload()
        payload['volume_take'] = 'Se registraron 45000 menciones en el periodo.'
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertFalse(ok)
        self.assertIn('45000', motivo)

    def test_rejects_invented_percentage(self):
        payload = _valid_payload()
        payload['sentiment_take'] = 'El 91,4% de las menciones fue negativo.'
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertFalse(ok)

    def test_allows_rhetorical_small_numbers(self):
        """'dos conversaciones' o 'uno de cada tres' no son datos que validar."""
        payload = _valid_payload()
        payload['conclusion_3'] = 'Dos conversaciones. Uno de cada 3 mensajes es crítico.'
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertTrue(ok, motivo)

    def test_rejects_missing_slot(self):
        payload = _valid_payload()
        payload['topics_take'] = ''
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertFalse(ok)
        self.assertIn('topics_take', motivo)

    def test_rejects_overlong_slot(self):
        payload = _valid_payload()
        payload['volume_title'] = 'X' * 200
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertFalse(ok)
        self.assertIn('volume_title', motivo)

    def test_accepts_compact_reach_printed_in_the_fact_sheet(self):
        """La regresion que descartaba los insights por el alcance compacto.

        La ficha imprime el alcance dos veces: el entero y su forma compacta
        ("15.8 B"). Esa segunda cifra no pasaba por el filtro que arma el
        allowlist, asi que el modelo la leia en la ficha, la citaba —como manda
        el contrato— y la validacion la tomaba por inventada, tirando los trece
        campos por una cifra que la propia ficha le habia dado.
        """
        texto, _, _ = insight_harness.build_fact_sheet(self.ctx)
        compacto = self.ctx['kpis']['estimated_reach_fmt']
        self.assertIn(compacto, texto)

        payload = _valid_payload()
        payload['volume_take'] = f'El alcance estimado fue de {compacto} impresiones.'
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertTrue(ok, motivo)

    def test_any_figure_printed_in_the_fact_sheet_is_quotable(self):
        """La regla general, no el caso suelto.

        Si una cifra se imprime en la ficha es citable por definicion: el
        contrato le pide al modelo justamente eso. Se comprueba sobre la ficha
        entera para que anadir una linea nueva manana no vuelva a abrir el
        hueco.
        """
        texto, nums, pcts = insight_harness.build_fact_sheet(self.ctx)
        enteros, decimales = insight_harness._numbers_in(texto)

        fuera = [n for n in enteros if n >= insight_harness.LITERAL_FLOOR and n not in nums]
        self.assertEqual(fuera, [], f'enteros impresos pero no permitidos: {fuera}')

        sin_permiso = [
            d for d in decimales
            if not any(abs(d - p) <= insight_harness.PCT_TOLERANCE for p in pcts)
            and d not in nums
        ]
        self.assertEqual(sin_permiso, [], f'decimales impresos pero no permitidos: {sin_permiso}')

    def test_accepts_spanish_thousands_separator(self):
        """33.146 y 33146 son la misma cifra."""
        payload = _valid_payload()
        payload['volume_take'] = 'Se registraron 33.146 menciones en el periodo.'
        ok, motivo = insight_harness.validate(payload, self.nums, self.pcts)
        self.assertTrue(ok, motivo)


class TestGenerateInsights(unittest.TestCase):

    def test_returns_insights_from_valid_model(self):
        ctx = _context()
        insights, meta = insight_harness.generate_insights(
            ctx, complete_fn=_fake_model(_valid_payload())
        )
        self.assertTrue(meta['ok'])
        self.assertEqual(insights['volume_title'], 'La conversación baja pero sigue siendo masiva')

    def test_discards_hallucinating_model(self):
        payload = _valid_payload()
        payload['volume_take'] = 'Hubo 999999 menciones.'
        ctx = _context()
        insights, meta = insight_harness.generate_insights(
            ctx, complete_fn=_fake_model(payload)
        )
        self.assertIsNone(insights)
        self.assertFalse(meta['ok'])

    def test_handles_model_wrapping_json_in_prose(self):
        ctx = _context()

        def _chatty(prompt, temperature=0.4, feature=None):
            return "Claro, aquí tienes:\n```json\n" + json.dumps(_valid_payload()) + "\n```"

        insights, meta = insight_harness.generate_insights(ctx, complete_fn=_chatty)
        self.assertTrue(meta['ok'], meta['reason'])
        self.assertIn('volume_title', insights)

    def test_no_provider_returns_none(self):
        ctx = _context()
        insights, meta = insight_harness.generate_insights(ctx, complete_fn=lambda p, temperature=0.4, feature=None: None)
        self.assertIsNone(insights)
        self.assertIn('no hay proveedor', meta['reason'])

    def test_provider_error_does_not_propagate(self):
        ctx = _context()

        def _boom(prompt, temperature=0.4, feature=None):
            raise RuntimeError('timeout')

        insights, meta = insight_harness.generate_insights(ctx, complete_fn=_boom)
        self.assertIsNone(insights)
        self.assertFalse(meta['ok'])


class TestDeterministicFloor(unittest.TestCase):

    def test_context_always_has_every_slot(self):
        """Sin IA, el reporte sigue teniendo todos los textos."""
        ctx = _context()
        self.assertEqual(ctx['insights_source'], 'reglas')
        for slot in insight_harness.SLOTS:
            self.assertIn(slot, ctx['insights'])
            self.assertTrue(str(ctx['insights'][slot]).strip(), f"slot vacío: {slot}")

class TestMeltwaterAnalysis(unittest.TestCase):
    """El análisis opcional de Meltwater como contexto extra."""

    def test_absent_by_default(self):
        prompt, _, _ = insight_harness.build_prompt(_context())
        self.assertNotIn('ANÁLISIS DE MELTWATER', prompt)

    def test_included_when_provided(self):
        ctx = _context()
        ctx['meltwater_analysis'] = 'El repunte lo detona una comparecencia parlamentaria.'
        prompt, _, _ = insight_harness.build_prompt(ctx)
        self.assertIn('ANÁLISIS DE MELTWATER', prompt)
        self.assertIn('comparecencia parlamentaria', prompt)
        # Se marca como dato, no como orden.
        self.assertIn('no son instrucciones', prompt)

    def test_analysis_figures_join_the_allowlist(self):
        """Sin esto, citar una cifra del propio análisis tumbaría el reporte."""
        ctx = _context()
        ctx['meltwater_analysis'] = 'La cobertura sumó 4820 impactos en television.'

        _, nums_sin, _ = insight_harness.build_prompt(_context())
        _, nums_con, _ = insight_harness.build_prompt(ctx)

        self.assertNotIn(4820, nums_sin)
        self.assertIn(4820, nums_con)

    def test_model_may_cite_analysis_figure(self):
        ctx = _context()
        ctx['meltwater_analysis'] = 'La cobertura sumó 4820 impactos en television.'
        payload = _valid_payload()
        payload['topics_take'] = 'La cobertura sumó 4820 impactos.'

        insights, meta = insight_harness.generate_insights(
            ctx, complete_fn=_fake_model(payload))
        self.assertTrue(meta['ok'], meta['reason'])

    def test_invented_figure_still_rejected_with_analysis(self):
        """El guardarrail sigue vivo: el análisis amplía, no desactiva."""
        ctx = _context()
        ctx['meltwater_analysis'] = 'La cobertura sumó 4820 impactos.'
        payload = _valid_payload()
        payload['topics_take'] = 'La cobertura sumó 99999 impactos.'

        insights, meta = insight_harness.generate_insights(
            ctx, complete_fn=_fake_model(payload))
        self.assertIsNone(insights)
        self.assertIn('99999', meta['reason'])


if __name__ == '__main__':
    unittest.main()
