"""
Seguridad de la puerta de la API interna (blueprints/interno.py) mas alla de
lo que cubre test_interno.py: valores raros en X-Usuario-Id, que con un token
valido no pueden tumbar el servicio ni resolver a otro usuario.
"""
import io

import pytest

from blueprints import interno
from test_interno import TOKEN, client, usuarios  # noqa: F401  (fixtures)


def _h(valor):
    return {'Authorization': f'Bearer {TOKEN}', 'X-Usuario-Id': valor}


@pytest.mark.parametrize('valor', [
    '²',                     # str.isdigit() lo acepta, int() lo rechaza: era un 500
    '¹',
    '1' * 40,                # desborda el entero de la base
    ' 1 ',                   # se recorta: valido, pero solo con digitos ASCII
    '-1',
    '+1',
    '0',
    '1e3',
])
def test_un_x_usuario_id_raro_nunca_es_500(client, usuarios, valor):  # noqa: F811
    r = client.get('/api/interno/salud', headers=_h(valor))
    assert r.status_code in (200, 401), (valor, r.status_code)
    if valor.strip() != '1':
        assert r.status_code == 401, valor


def test_el_limite_por_herramienta_vale_tambien_sin_content_length(client, usuarios, monkeypatch):  # noqa: F811
    """Una subida 'chunked' no trae Content-Length: el limite de la herramienta
    se saltaba y solo quedaba el global de 200 MB (60 MB para reportes)."""
    from werkzeug.test import EnvironBuilder

    monkeypatch.setitem(interno.LIMITES, 'csv_analysis', 500)
    cuerpo = EnvironBuilder(method='POST', data={'archivo': (io.BytesIO(b'a,b\n' * 2000), 'x.csv')}).get_environ()
    crudo = cuerpo['wsgi.input'].read()
    cabeceras = {**_h(str(usuarios['ana'])), 'Content-Type': cuerpo['CONTENT_TYPE'], 'Transfer-Encoding': 'chunked'}
    r = client.post('/api/interno/analisis/detectar', headers=cabeceras, input_stream=io.BytesIO(crudo),
                    environ_overrides={'wsgi.input_terminated': True})
    assert r.status_code == 413, r.get_json()


def test_el_token_no_se_compara_por_prefijo(client, usuarios):  # noqa: F811
    uid = str(usuarios['ana'])
    for malo in (TOKEN[:-1], TOKEN + 'x', TOKEN.upper(), f' {TOKEN}'):
        r = client.get('/api/interno/salud', headers={'Authorization': f'Bearer {malo}', 'X-Usuario-Id': uid})
        assert r.status_code == 401, malo


def test_sin_token_la_cabecera_de_usuario_no_cuenta(client, usuarios):  # noqa: F811
    """X-Usuario-Id solo vale detras de un token valido, ni siquiera para el admin."""
    r = client.get('/api/interno/salud', headers={'X-Usuario-Id': str(usuarios['admin'])})
    assert r.status_code == 401
    r = client.get('/api/interno/reportes', headers={'X-Usuario-Id': str(usuarios['admin']), 'Authorization': 'Basic x'})
    assert r.status_code == 401
