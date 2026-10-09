"""
Seguridad de la puerta de la API interna (blueprints/interno.py) mas alla de
lo que cubre test_interno.py: valores raros en X-Usuario-Id, que con un token
valido no pueden tumbar el servicio ni resolver a otro usuario.
"""
import pytest

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
