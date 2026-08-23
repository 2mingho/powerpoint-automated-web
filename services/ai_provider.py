"""
services/ai_provider.py
-----------------------
Single entry point for every LLM call in the app.

The provider, model and key come from the `ai_providers` table (managed from
the admin panel), so switching from Groq to Anthropic — or to a different
model of the same provider — is a change an administrator makes in the UI, not
a deploy. `GROQ_API_KEY` in the environment is still honoured as a fallback so
existing installs keep working until someone configures a connection.

Every call degrades gracefully: if no provider is configured, the request
fails, or the response is malformed, the caller gets `None` and the report is
built without the AI-enriched part rather than erroring out.
"""
import os
import logging

import requests

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 30

# provider key -> (endpoint, builder, parser). Adding a provider is adding a row.
PROVIDER_ENDPOINTS = {
    'groq': 'https://api.groq.com/openai/v1/chat/completions',
    'openai': 'https://api.openai.com/v1/chat/completions',
    'anthropic': 'https://api.anthropic.com/v1/messages',
}

SUPPORTED_PROVIDERS = tuple(PROVIDER_ENDPOINTS)


def get_active_provider():
    """Return the active AIProvider row, or None.

    Imported lazily so this module stays usable (and testable) without an app
    context, and so importing it never drags in the DB layer.
    """
    try:
        from models import AIProvider
        return AIProvider.query.filter_by(is_active=True).first()
    except Exception:
        # Tabla ausente (migracion sin aplicar) o sin contexto de aplicacion.
        #
        # El rollback no es decorativo. En PostgreSQL, una consulta contra una
        # tabla inexistente aborta la transaccion entera: a partir de ahi
        # cualquier otra consulta de la misma sesion responde
        # "current transaction is aborted". Devolver None sin deshacer dejaba
        # la sesion envenenada y tumbaba la peticion completa mas adelante,
        # al guardar el reporte. En SQLite no pasa, y por eso en local no se
        # veia. Que falte el proveedor de IA debe degradar el reporte, no
        # romperlo.
        _rollback_quietly()
        return None


def _rollback_quietly():
    try:
        from extensions import db
        db.session.rollback()
    except Exception:
        pass


def _row_to_conn(row):
    return {
        'id': row.id,
        'provider': row.provider,
        'model': row.model,
        'api_key': row.api_key,
        'price_in_per_1m': getattr(row, 'price_in_per_1m', 0.0),
        'price_out_per_1m': getattr(row, 'price_out_per_1m', 0.0),
    }


def _fallback_from_env():
    """Legacy escape hatch: GROQ_API_KEY in the environment."""
    key = os.getenv('GROQ_API_KEY')
    if key and key != 'no_api_key_provided':
        return {'provider': 'groq', 'model': 'llama-3.3-70b-versatile', 'api_key': key}
    return None


def _resolve_connection():
    row = get_active_provider()
    if row is not None:
        return _row_to_conn(row)
    return _fallback_from_env()


def is_configured():
    """True when some provider is available — used to tailor the UI."""
    return _resolve_connection() is not None


def _call_openai_compatible(conn, prompt, endpoint, temperature):
    """Devuelve (texto, uso). `uso` = (tokens_entrada, tokens_salida)."""
    resp = requests.post(
        endpoint,
        headers={
            'Authorization': f"Bearer {conn['api_key']}",
            'Content-Type': 'application/json',
        },
        json={
            'model': conn['model'],
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': temperature,
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    uso = data.get('usage') or {}
    return (
        data['choices'][0]['message']['content'],
        (uso.get('prompt_tokens', 0), uso.get('completion_tokens', 0)),
    )


def _call_anthropic(conn, prompt, temperature):
    resp = requests.post(
        PROVIDER_ENDPOINTS['anthropic'],
        headers={
            'x-api-key': conn['api_key'],
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        json={
            'model': conn['model'],
            'max_tokens': 4096,
            'temperature': temperature,
            'messages': [{'role': 'user', 'content': prompt}],
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    uso = data.get('usage') or {}
    return (
        data['content'][0]['text'],
        (uso.get('input_tokens', 0), uso.get('output_tokens', 0)),
    )


def _record_usage(conn, tokens_in, tokens_out, feature, ok=True):
    """Registra una llamada. Nunca deja que un fallo de registro tumbe el reporte."""
    try:
        from flask_login import current_user
        from extensions import db
        from models import AIUsage

        precio_in = conn.get('price_in_per_1m') or 0.0
        precio_out = conn.get('price_out_per_1m') or 0.0
        coste = (tokens_in / 1_000_000) * precio_in + (tokens_out / 1_000_000) * precio_out

        user_id = None
        try:
            if getattr(current_user, 'is_authenticated', False):
                user_id = current_user.id
        except Exception:
            pass

        db.session.add(AIUsage(
            provider_id=conn.get('id'),
            provider=conn.get('provider', ''),
            model=conn.get('model', ''),
            feature=feature,
            tokens_in=tokens_in or 0,
            tokens_out=tokens_out or 0,
            cost_usd=round(coste, 6),
            ok=ok,
            user_id=user_id,
        ))
        db.session.commit()
    except Exception as e:
        # Mismo motivo que en get_active_provider: un commit fallido deja la
        # sesion inservible para el resto de la peticion.
        _rollback_quietly()
        logger.warning('No se pudo registrar el consumo de IA: %s', e)


def complete(prompt, temperature=0.2, feature=None):
    """Send *prompt* to the configured provider. Returns the text, or None.

    Cada llamada queda registrada con sus tokens y su coste, para que el panel
    pueda responder en qué se está gastando.
    """
    conn = _resolve_connection()
    if conn is None:
        logger.info('No hay proveedor de IA configurado; se omite la llamada.')
        return None

    provider = (conn['provider'] or '').lower()
    try:
        if provider == 'anthropic':
            texto, uso = _call_anthropic(conn, prompt, temperature)
        elif provider in ('groq', 'openai'):
            texto, uso = _call_openai_compatible(
                conn, prompt, PROVIDER_ENDPOINTS[provider], temperature)
        else:
            logger.warning('Proveedor de IA no soportado: %s', provider)
            return None

        _record_usage(conn, uso[0], uso[1], feature, ok=True)
        return texto
    except Exception as e:
        logger.warning('Fallo la llamada al proveedor de IA (%s): %s', provider, e)
        # La llamada fallida también se registra: una racha de errores es
        # justo lo que se quiere ver en el panel.
        _record_usage(conn, 0, 0, feature, ok=False)
        return None


def test_connection(provider, model, api_key):
    """Probe a connection from the admin panel. Returns (ok, message)."""
    conn = {'provider': (provider or '').lower(), 'model': model, 'api_key': api_key}
    prompt = "Responde unicamente con la palabra: ok"
    try:
        if conn['provider'] == 'anthropic':
            text, _ = _call_anthropic(conn, prompt, 0)
        elif conn['provider'] in ('groq', 'openai'):
            text, _ = _call_openai_compatible(conn, prompt, PROVIDER_ENDPOINTS[conn['provider']], 0)
        else:
            return False, f"Proveedor no soportado: {provider}"
        return True, f"Conexion correcta. Respuesta: {(text or '').strip()[:60]}"
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else '?'
        if status == 401:
            return False, "La clave API fue rechazada (401)."
        if status == 404:
            return False, f"El modelo '{model}' no existe para este proveedor (404)."
        return False, f"El proveedor respondio con error {status}."
    except Exception as e:
        return False, f"No se pudo conectar: {e}"


# ─────────────────────────────────────────────────────────────
# Traduccion de texto libre (AI-Powered Clusters)
# ─────────────────────────────────────────────────────────────

def translate_texts(texts, target_language='español'):
    """
    Translate a list of free-form strings, preserving order and count.

    Meltwater writes its AI cluster summaries in English no matter the language
    of the conversation, and they differ in every report, so a static map can't
    cover them. Returns the originals untouched when no provider is configured
    or the response doesn't line up — a report in mixed language beats a report
    with mangled or missing topics.
    """
    items = [t for t in (texts or []) if str(t).strip()]
    if not items:
        return list(texts or [])

    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(items))
    prompt = (
        f"Traduce al {target_language} cada una de las siguientes frases.\n"
        f"Devuelve EXACTAMENTE {len(items)} lineas, numeradas igual que la entrada, "
        f"sin comentarios ni texto adicional. Conserva los nombres propios.\n\n"
        f"{numbered}"
    )

    raw = complete(prompt, temperature=0, feature='traduccion')
    if not raw:
        return list(texts)

    parsed = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # Strip the "N." prefix the model was asked to keep.
        if '.' in line[:4]:
            head, _, tail = line.partition('.')
            if head.strip().isdigit():
                line = tail.strip()
        parsed.append(line)

    if len(parsed) != len(items):
        logger.warning(
            'La traduccion devolvio %s lineas para %s frases; se conserva el original.',
            len(parsed), len(items),
        )
        return list(texts)

    return parsed
