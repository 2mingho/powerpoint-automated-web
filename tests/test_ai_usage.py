import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_ai_usage.db')
os.environ.setdefault('WTF_CSRF_ENABLED', 'False')

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import AIProvider, AIUsage  # noqa: E402
from services import ai_provider  # noqa: E402


class _Resp:
    """Respuesta HTTP simulada, con el `usage` que devuelve cada proveedor."""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


GROQ_OK = _Resp({
    'choices': [{'message': {'content': 'hola'}}],
    'usage': {'prompt_tokens': 1000, 'completion_tokens': 500},
})

ANTHROPIC_OK = _Resp({
    'content': [{'text': 'hola'}],
    'usage': {'input_tokens': 2000, 'output_tokens': 1000},
})


class TestAIUsage(unittest.TestCase):

    def setUp(self):
        self.ctx = app_module.app.app_context()
        self.ctx.push()
        db.create_all()
        AIUsage.query.delete()
        AIProvider.query.delete()
        db.session.commit()

    def tearDown(self):
        db.session.rollback()
        self.ctx.pop()

    def _conexion(self, provider='groq', model='llama-3.3-70b-versatile',
                  p_in=1.0, p_out=2.0):
        c = AIProvider(name='prueba', provider=provider, model=model,
                       api_key='k', is_active=True,
                       price_in_per_1m=p_in, price_out_per_1m=p_out)
        db.session.add(c)
        db.session.commit()
        return c

    def test_records_tokens_and_cost(self):
        self._conexion(p_in=1.0, p_out=2.0)
        with patch('services.ai_provider.requests.post', return_value=GROQ_OK):
            texto = ai_provider.complete('hola', feature='insights')

        self.assertEqual(texto, 'hola')
        fila = AIUsage.query.one()
        self.assertEqual(fila.tokens_in, 1000)
        self.assertEqual(fila.tokens_out, 500)
        self.assertEqual(fila.feature, 'insights')
        self.assertTrue(fila.ok)
        # 1000/1M * $1 + 500/1M * $2 = 0.001 + 0.001
        self.assertAlmostEqual(fila.cost_usd, 0.002, places=6)

    def test_anthropic_usage_shape(self):
        """Anthropic usa input_tokens/output_tokens, no prompt/completion."""
        self._conexion(provider='anthropic', model='claude-sonnet-5',
                       p_in=3.0, p_out=15.0)
        with patch('services.ai_provider.requests.post', return_value=ANTHROPIC_OK):
            ai_provider.complete('hola', feature='traduccion')

        fila = AIUsage.query.one()
        self.assertEqual(fila.tokens_in, 2000)
        self.assertEqual(fila.tokens_out, 1000)
        # 2000/1M * $3 + 1000/1M * $15 = 0.006 + 0.015
        self.assertAlmostEqual(fila.cost_usd, 0.021, places=6)

    def test_failed_call_is_recorded(self):
        self._conexion()
        with patch('services.ai_provider.requests.post', side_effect=RuntimeError('timeout')):
            texto = ai_provider.complete('hola', feature='insights')

        self.assertIsNone(texto)
        fila = AIUsage.query.one()
        self.assertFalse(fila.ok)
        self.assertEqual(fila.tokens_in, 0)

    def test_connection_without_price_costs_zero(self):
        """Sin tarifa se siguen contando tokens; el coste queda en 0."""
        self._conexion(p_in=0.0, p_out=0.0)
        with patch('services.ai_provider.requests.post', return_value=GROQ_OK):
            ai_provider.complete('hola')

        fila = AIUsage.query.one()
        self.assertEqual(fila.tokens_in, 1000)
        self.assertEqual(fila.cost_usd, 0.0)

    def test_cost_is_frozen_at_call_time(self):
        """Cambiar la tarifa no debe reescribir lo ya gastado."""
        conexion = self._conexion(p_in=1.0, p_out=2.0)
        with patch('services.ai_provider.requests.post', return_value=GROQ_OK):
            ai_provider.complete('hola')

        conexion.price_in_per_1m = 100.0
        conexion.price_out_per_1m = 200.0
        db.session.commit()

        self.assertAlmostEqual(AIUsage.query.one().cost_usd, 0.002, places=6)

    def test_no_provider_records_nothing(self):
        with patch.dict(os.environ, {'GROQ_API_KEY': ''}, clear=False):
            texto = ai_provider.complete('hola')
        self.assertIsNone(texto)
        self.assertEqual(AIUsage.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
