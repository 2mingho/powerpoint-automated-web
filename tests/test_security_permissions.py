import os
import io

import pytest
from werkzeug.security import generate_password_hash


os.environ.setdefault('SECRET_KEY', 'test-secret-key')
os.environ.setdefault('FLASK_ENV', 'development')
os.environ.setdefault('SQLALCHEMY_DATABASE_URI', 'sqlite:///test_backend_security.db')
os.environ.setdefault('ALLOW_SELF_REGISTRATION', 'false')

import app as app_module  # noqa: E402
from extensions import db  # noqa: E402
from models import User, Report, Area, Task, TempArtifact  # noqa: E402
from datetime import date  # noqa: E402


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session['_user_id'] = str(user_id)
        session['_fresh'] = True


def _create_user(*, username, email, role='DI', is_active=True, tools=None):
    user = User(
        username=username,
        email=email,
        password=generate_password_hash('test-password-123', method='scrypt'),
        role=role,
        is_active=is_active,
    )
    if tools is not None:
        user.set_allowed_tools(tools)
    db.session.add(user)
    db.session.commit()
    return user.id


def _create_area(name):
    area = Area(name=name)
    db.session.add(area)
    db.session.commit()
    return area.id


def _create_task(*, title, due_date, area, creator_id, assignee_id):
    task = Task(
        title=title,
        due_date=due_date,
        area=area,
        creator_id=creator_id,
        assignee_id=assignee_id,
    )
    db.session.add(task)
    db.session.commit()
    return task.id


@pytest.fixture
def client():
    app = app_module.app
    app.config.update(
        TESTING=True,
        WTF_CSRF_ENABLED=False,
        ALLOW_SELF_REGISTRATION=False,
    )

    with app.app_context():
        db.drop_all()
        db.create_all()

    with app.test_client() as test_client:
        yield test_client


def test_register_disabled_by_default(client):
    response = client.get('/register', follow_redirects=False)

    assert response.status_code == 403
    assert '/login' in response.headers.get('Location', '')


def test_tasks_access_required_blocks_user_without_tasks_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-tasks-user',
            email='no-tasks@example.com',
            tools=['reports', 'classification'],
        )

    _login_as(client, user)
    response = client.get('/tasks', follow_redirects=False)

    assert response.status_code == 403


def test_download_requires_report_ownership(client):
    report_path = None
    with app_module.app.app_context():
        owner = _create_user(username='owner-user', email='owner@example.com')
        other = _create_user(username='other-user', email='other@example.com')

        os.makedirs(app_module.app.config['UPLOAD_FOLDER'], exist_ok=True)
        report_name = 'owned_report.zip'
        report_path = os.path.join(app_module.app.config['UPLOAD_FOLDER'], report_name)
        with open(report_path, 'wb') as file_handle:
            file_handle.write(b'test-content')

        report = Report(filename=report_name, user_id=owner, title='Owned report')
        db.session.add(report)
        db.session.commit()

    _login_as(client, other)
    response = client.get(f'/download/{report_name}', follow_redirects=False)

    assert response.status_code == 403

    if report_path and os.path.exists(report_path):
        os.remove(report_path)


def test_inactive_user_is_logged_out_on_request(client):
    with app_module.app.app_context():
        inactive = _create_user(
            username='inactive-user',
            email='inactive@example.com',
            is_active=False,
        )

    _login_as(client, inactive)
    response = client.get('/menu', follow_redirects=False)

    assert response.status_code == 302
    assert '/login' in response.headers.get('Location', '')

    with client.session_transaction() as session:
        assert '_user_id' not in session


def test_upload_csv_requires_reports_tool_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-reports-upload',
            email='no-reports-upload@example.com',
            tools=['classification'],
        )

    _login_as(client, user)
    response = client.post(
        '/upload_csv',
        data={
            'csv_file': (io.BytesIO(b'columna\nvalor\n'), 'test.csv'),
        },
        content_type='multipart/form-data',
    )

    assert response.status_code == 403


def test_generate_pptx_requires_reports_tool_permission(client):
    with app_module.app.app_context():
        user = _create_user(
            username='no-reports-pptx',
            email='no-reports-pptx@example.com',
            tools=['classification'],
        )

    _login_as(client, user)
    response = client.post(
        '/generate_pptx',
        json={'meta': {'client_name': 'Cliente de prueba'}},
    )

    assert response.status_code == 403


def test_non_admin_cannot_delete_tasks_for_other_unit_by_day(client):
    target_day = date(2026, 1, 15)

    with app_module.app.app_context():
        area_a_id = _create_area('Unidad-A')
        area_b_id = _create_area('Unidad-B')

        unit_a_user_id = _create_user(
            username='unit-a-user',
            email='unit-a-user@example.com',
            role='DI',
            tools=['tasks'],
        )
        unit_b_user_id = _create_user(
            username='unit-b-user',
            email='unit-b-user@example.com',
            role='DI',
            tools=['tasks'],
        )

        unit_a_user = db.session.get(User, unit_a_user_id)
        unit_b_user = db.session.get(User, unit_b_user_id)
        unit_a_user.area_id = area_a_id
        unit_b_user.area_id = area_b_id
        db.session.commit()

        own_task_id = _create_task(
            title='Tarea unidad A',
            due_date=target_day,
            area='DI',
            creator_id=unit_a_user_id,
            assignee_id=unit_a_user_id,
        )
        other_task_id = _create_task(
            title='Tarea unidad B',
            due_date=target_day,
            area='DI',
            creator_id=unit_b_user_id,
            assignee_id=unit_b_user_id,
        )

    _login_as(client, unit_a_user_id)
    response = client.delete(f'/api/tasks/day/{target_day.isoformat()}')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['deleted'] == 1

    with app_module.app.app_context():
        assert db.session.get(Task, own_task_id) is None
        assert db.session.get(Task, other_task_id) is not None


# ─────────────────────────────────────────────────────────────
# SEC-03: las sesiones de clasificacion pertenecen a quien las crea
# ─────────────────────────────────────────────────────────────

def _start_classification_session(client, user_id):
    """Sube un CSV minimo y devuelve el session_id generado."""
    _login_as(client, user_id)
    csv_bytes = b'Hit Sentence,Autor\nprimera mencion,ana\nsegunda mencion,luis\n'
    data = {'csv_file': (io.BytesIO(csv_bytes), 'fuente.csv')}
    response = client.post('/clasificacion/upload', data=data,
                           content_type='multipart/form-data')
    assert response.status_code == 200, response.data
    payload = response.get_json()
    assert payload['success'], payload
    return payload['session_id']


def test_classification_session_is_registered_to_its_creator(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner', email='clf-owner@example.com',
                                tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    with app_module.app.app_context():
        artifact = TempArtifact.query.filter_by(kind='classify_session',
                                                file_id=session_id).first()
        assert artifact is not None and artifact.user_id == owner_id
    assert client.get(f'/clasificacion/upload_body/{session_id}').status_code == 200


def test_classification_session_body_not_readable_by_other_user(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner2', email='clf-owner2@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder', email='clf-intruder@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    assert client.get(f'/clasificacion/upload_body/{session_id}').status_code == 403


def test_classification_chunk_rejected_for_other_user(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner3', email='clf-owner3@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder3', email='clf-intruder3@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    response = client.post('/clasificacion/chunk', json={
        'session_id': session_id, 'header': 'Hit Sentence',
        'rows': 'fila inyectada', 'rules': [], 'chunk_index': 0,
    })
    assert response.status_code == 403


def test_classification_finalize_cannot_hijack_another_session(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='clf-owner4', email='clf-owner4@example.com',
                                tools=['classification'])
        intruder_id = _create_user(username='clf-intruder4', email='clf-intruder4@example.com',
                                   tools=['classification'])
    session_id = _start_classification_session(client, owner_id)
    _login_as(client, intruder_id)
    assert client.post('/clasificacion/finalize', json={
        'session_id': session_id, 'original_name': 'robado.csv'}).status_code == 403
    with app_module.app.app_context():
        artifact = TempArtifact.query.filter_by(kind='classify_session',
                                                file_id=session_id).first()
        assert artifact is not None and artifact.user_id == owner_id


# ─────────────────────────────────────────────────────────────
# SEC-02 / FUN-06: /generate_pptx valida y no escribe fuera de scratch
# ─────────────────────────────────────────────────────────────

def test_generate_pptx_rejects_missing_client_name(client):
    with app_module.app.app_context():
        user_id = _create_user(username='ppt-user', email='ppt-user@example.com',
                               tools=['reports'])
    _login_as(client, user_id)
    response = client.post('/generate_pptx', json={'meta': {}})
    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_generate_pptx_does_not_write_outside_scratch(client):
    with app_module.app.app_context():
        user_id = _create_user(username='ppt-user2', email='ppt-user2@example.com',
                               tools=['reports'])
    _login_as(client, user_id)
    client.post('/generate_pptx', json={'meta': {'client_name': '../../pwned'}})
    scratch_root = os.path.abspath(app_module.app.config['UPLOAD_FOLDER'])
    escaped = os.path.join(os.path.dirname(os.path.dirname(scratch_root)),
                           'Reporte_pwned.pptx')
    assert not os.path.exists(escaped)


# ─────────────────────────────────────────────────────────────
# Proteccion de la base de produccion en arranques locales
# ─────────────────────────────────────────────────────────────

def _with_uri(uri, production):
    original_uri = app_module.app.config['SQLALCHEMY_DATABASE_URI']
    original_is_prod = app_module._is_production_mode
    app_module.app.config['SQLALCHEMY_DATABASE_URI'] = uri
    app_module._is_production_mode = lambda: production
    try:
        return app_module._startup_db_writes_allowed()
    finally:
        app_module.app.config['SQLALCHEMY_DATABASE_URI'] = original_uri
        app_module._is_production_mode = original_is_prod


def test_startup_never_writes_to_remote_db_from_a_dev_machine():
    """
    Exportar la DATABASE_URL de produccion en local no debe bastar para que el
    arranque cree tablas, siembre el admin o ejecute la poda (que BORRA datos).
    """
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=False) is False


def test_startup_writes_allowed_on_local_sqlite():
    assert _with_uri('sqlite:///instance/users.db', production=False) is True


def test_startup_writes_allowed_in_production():
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=True) is True


# ─────────────────────────────────────────────────────────────
# FUN-01: zona horaria de negocio
# ─────────────────────────────────────────────────────────────

def test_business_timezone_is_behind_utc():
    """
    Republica Dominicana es UTC-4 todo el ano. A las 02:00 UTC del dia D en el
    servidor, para el equipo son las 22:00 del dia D-1.
    """
    from datetime import datetime, timezone, timedelta
    from services.clock import APP_TIMEZONE
    utc_moment = datetime(2026, 3, 11, 2, 0, tzinfo=timezone.utc)
    local_moment = utc_moment.astimezone(APP_TIMEZONE)
    assert local_moment.date() == utc_moment.date() - timedelta(days=1)
    assert local_moment.hour == 22


def test_today_local_is_consistent_with_now_local():
    from services.clock import now_local, today_local
    assert today_local() == now_local().date()


# ─────────────────────────────────────────────────────────────
# Jerarquia de mando: liderazgo multiple y herencia por director
# ─────────────────────────────────────────────────────────────

def test_unit_lead_allows_leading_several_units(client):
    """Un manager puede llevar mas de una unidad.

    Es justo lo que el modelo anterior no sabia expresar: users.area_id es una
    sola unidad, y is_area_lead un si o no.
    """
    from models import UnitLead

    with app_module.app.app_context():
        uno = _create_area('Unidad uno')
        dos = _create_area('Unidad dos')
        manager = _create_user(username='manager-doble', email='manager-doble@example.com')

        db.session.add(UnitLead(user_id=manager, area_id=uno))
        db.session.add(UnitLead(user_id=manager, area_id=dos))
        db.session.commit()

        lideradas = {fila.area_id for fila in db.session.get(User, manager).unidades_lideradas}

    assert lideradas == {uno, dos}


def test_manager_chain_is_traversable(client):
    """El director llega a las unidades a traves de sus managers.

    No tiene ninguna fila en unit_leads: su alcance se deriva recorriendo la
    cadena de mando hacia abajo.
    """
    from models import UnitLead

    with app_module.app.app_context():
        area_uno = _create_area('Area uno')
        area_dos = _create_area('Area dos')

        manager_uno = _create_user(username='mgr-uno', email='mgr-uno@example.com')
        manager_dos = _create_user(username='mgr-dos', email='mgr-dos@example.com')
        director = _create_user(username='dir', email='dir@example.com')

        db.session.add(UnitLead(user_id=manager_uno, area_id=area_uno))
        db.session.add(UnitLead(user_id=manager_dos, area_id=area_dos))
        db.session.get(User, manager_uno).manager_id = director
        db.session.get(User, manager_dos).manager_id = director
        db.session.commit()

        jefe = db.session.get(User, director)
        assert jefe.unidades_lideradas.count() == 0, 'el director no lidera ninguna directamente'

        heredadas = set()
        for reporte in jefe.reportes:
            heredadas.update(fila.area_id for fila in reporte.unidades_lideradas)

    assert heredadas == {area_uno, area_dos}


def test_deleting_a_unit_clears_its_leadership(client):
    """Borrar una unidad no puede dejar filas de liderazgo huerfanas."""
    from models import UnitLead

    with app_module.app.app_context():
        area = _create_area('Unidad efimera')
        manager = _create_user(username='mgr-efimero', email='mgr-efimero@example.com')
        db.session.add(UnitLead(user_id=manager, area_id=area))
        db.session.commit()

        db.session.execute(db.text('DELETE FROM areas WHERE id = :id'), {'id': area})
        db.session.commit()

        restantes = db.session.query(UnitLead).filter_by(area_id=area).count()

    assert restantes == 0


# ─────────────────────────────────────────────────────────────
# El resolvedor de alcance
# ─────────────────────────────────────────────────────────────

def _montar_organizacion():
    """Marta lleva la unidad 1, Luis la 2 y Sara manda sobre los dos.

    Es el caso que el modelo anterior no sabia expresar: Sara no aparece en
    ninguna fila de liderazgo y aun asi debe ver las dos unidades.
    """
    from models import UnitLead

    uno = _create_area('Unidad uno')
    dos = _create_area('Unidad dos')

    marta = _create_user(username='marta', email='marta@example.com')
    luis = _create_user(username='luis', email='luis@example.com')
    sara = _create_user(username='sara', email='sara@example.com')
    ana = _create_user(username='ana', email='ana@example.com')

    db.session.add(UnitLead(user_id=marta, area_id=uno))
    db.session.add(UnitLead(user_id=luis, area_id=dos))
    db.session.get(User, marta).manager_id = sara
    db.session.get(User, luis).manager_id = sara
    db.session.get(User, ana).manager_id = marta  # empleada, no lidera nada
    db.session.commit()

    return {'uno': uno, 'dos': dos, 'marta': marta, 'luis': luis, 'sara': sara, 'ana': ana}


def test_director_hereda_las_unidades_de_sus_managers(client):
    from services.alcance import alcance_unidades, unidades_lideradas

    with app_module.app.app_context():
        o = _montar_organizacion()
        sara = db.session.get(User, o['sara'])

        assert unidades_lideradas(sara) == set(), 'no lidera ninguna directamente'
        assert alcance_unidades(sara) == {o['uno'], o['dos']}


def test_manager_solo_ve_la_suya(client):
    from services.alcance import alcance_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        assert alcance_unidades(db.session.get(User, o['marta'])) == {o['uno']}


def test_empleado_no_hereda_de_su_manager(client):
    """Ana pertenece a la unidad de Marta pero no la lidera.

    La herencia baja por la cadena de mando, no sube.
    """
    from services.alcance import alcance_unidades, puede_ver_equipo

    with app_module.app.app_context():
        o = _montar_organizacion()
        ana = db.session.get(User, o['ana'])

        assert alcance_unidades(ana) == set()
        assert puede_ver_equipo(ana) is False


def test_la_cadena_de_mando_es_transitiva(client):
    """Quien manda sobre Sara ve lo mismo que ella, sin filas nuevas."""
    from services.alcance import alcance_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        jefa = _create_user(username='jefa', email='jefa@example.com')
        db.session.get(User, o['sara']).manager_id = jefa
        db.session.commit()

        assert alcance_unidades(db.session.get(User, jefa)) == {o['uno'], o['dos']}


def test_un_ciclo_en_la_cadena_no_cuelga(client):
    """Un ciclo no es un dato raro: es un bucle infinito en cada peticion."""
    from services.alcance import personas_a_cargo

    with app_module.app.app_context():
        uno = _create_user(username='ciclo-uno', email='ciclo-uno@example.com')
        dos = _create_user(username='ciclo-dos', email='ciclo-dos@example.com')
        db.session.get(User, uno).manager_id = dos
        db.session.get(User, dos).manager_id = uno
        db.session.commit()

        assert personas_a_cargo(db.session.get(User, uno)) == {uno, dos}


def test_el_admin_alcanza_todas_las_unidades(client):
    from services.alcance import alcance_unidades, puede_ver_equipo

    with app_module.app.app_context():
        o = _montar_organizacion()
        admin_id = _create_user(username='jefe-todo', email='jefe-todo@example.com', role='admin')
        admin = db.session.get(User, admin_id)

        assert alcance_unidades(admin) == {o['uno'], o['dos']}
        assert puede_ver_equipo(admin) is True


def test_el_papel_se_deduce_de_los_datos(client):
    from services.alcance import papel

    with app_module.app.app_context():
        o = _montar_organizacion()
        assert papel(db.session.get(User, o['ana'])) == 'empleado'
        assert papel(db.session.get(User, o['marta'])) == 'manager'
        assert papel(db.session.get(User, o['sara'])) == 'director'


def test_quitar_el_liderazgo_vacia_el_alcance_del_director(client):
    """Cierra en falso: sin liderazgo debajo, el director deja de ver nada.

    Un conjunto vacio tiene que producir cero filas, nunca todas.
    """
    from models import UnitLead
    from services.alcance import alcance_unidades, puede_ver_equipo

    with app_module.app.app_context():
        o = _montar_organizacion()
        db.session.query(UnitLead).delete()
        db.session.commit()

        sara = db.session.get(User, o['sara'])
        assert alcance_unidades(sara) == set()
        assert puede_ver_equipo(sara) is False


def test_el_cache_dura_una_peticion_y_no_mas(client):
    """Un alcance memorizado de mas es un fallo de permisos.

    Dentro de una peticion se reutiliza; entre peticiones se vuelve a calcular,
    de modo que quitarle el liderazgo a alguien surte efecto en la siguiente.
    """
    from models import UnitLead
    from services.alcance import alcance_unidades, invalidar_cache_alcance

    with app_module.app.app_context():
        o = _montar_organizacion()
        sara_id, uno, dos = o['sara'], o['uno'], o['dos']

    with app_module.app.test_request_context('/'):
        sara = db.session.get(User, sara_id)
        assert alcance_unidades(sara) == {uno, dos}

        # Se retira el liderazgo en la MISMA peticion: el cache aun lo recuerda.
        db.session.query(UnitLead).delete()
        db.session.commit()
        assert alcance_unidades(sara) == {uno, dos}, 'deberia venir del cache'

        # Y se puede invalidar a mano cuando la peticion cambia el reparto.
        invalidar_cache_alcance()
        assert alcance_unidades(sara) == set()

    # Peticion nueva: se calcula de cero, sin arrastrar nada.
    with app_module.app.test_request_context('/'):
        assert alcance_unidades(db.session.get(User, sara_id)) == set()


def test_el_resolvedor_funciona_sin_peticion(client):
    """Los comandos de consola y las tareas de arranque no tienen peticion."""
    from services.alcance import alcance_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        assert alcance_unidades(db.session.get(User, o['sara'])) == {o['uno'], o['dos']}


def test_tras_el_traspaso_el_alcance_es_el_de_hoy(client):
    """La propiedad que hace segura a 0004.

    El traspaso crea, para cada lider actual, una fila hacia la unidad a la que
    pertenece. Sin directores asignados el alcance resultante debe ser
    exactamente esa unidad: ni una mas. Si esto falla, la migracion amplia
    permisos en silencio.
    """
    from models import UnitLead
    from services.alcance import alcance_unidades

    with app_module.app.app_context():
        area = _create_area('Unidad heredada')
        lider = _create_user(username='lider-actual', email='lider-actual@example.com')
        usuario = db.session.get(User, lider)
        usuario.area_id = area
        usuario.is_area_lead = True
        # Lo que escribe el traspaso de 0004:
        db.session.add(UnitLead(user_id=lider, area_id=area))
        db.session.commit()

        assert alcance_unidades(db.session.get(User, lider)) == {area}


def test_el_empleado_conserva_su_unidad_para_trabajar(client):
    """Ambito y alcance no son lo mismo.

    Un empleado no supervisa nada —su alcance es vacio— pero sigue trabajando
    con su unidad. Confundirlos lo dejaria sin poder asignar una tarea a un
    companero, que es una regresion silenciosa.
    """
    from services.alcance import alcance_unidades, ambito_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        ana = db.session.get(User, o['ana'])
        ana.area_id = o['uno']
        db.session.commit()

        assert alcance_unidades(ana) == set(), 'no supervisa nada'
        assert ambito_unidades(ana) == {o['uno']}, 'pero trabaja en su unidad'


def test_el_manager_trabaja_con_las_unidades_que_lidera(client):
    from services.alcance import ambito_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        marta = db.session.get(User, o['marta'])
        marta.area_id = o['uno']
        db.session.commit()

        assert ambito_unidades(marta) == {o['uno']}


def test_el_director_trabaja_con_las_de_sus_managers(client):
    """Sara no pertenece a ninguna unidad y aun asi trabaja con las dos."""
    from services.alcance import ambito_unidades

    with app_module.app.app_context():
        o = _montar_organizacion()
        assert ambito_unidades(db.session.get(User, o['sara'])) == {o['uno'], o['dos']}


def test_sin_unidad_ni_liderazgo_solo_queda_uno_mismo(client):
    """Cierra en falso, pero sin dejar a nadie sin poder trabajar.

    El respaldo por rol que habia antes era un desvio: alguien sin unidad veia
    a todos los de su rol, que no es una unidad.
    """
    with app_module.app.app_context():
        huerfano = _create_user(username='sin-unidad', email='sin-unidad@example.com')
        db.session.get(User, huerfano).area_id = None
        _create_user(username='mismo-rol', email='mismo-rol@example.com')
        db.session.commit()

    _login_as(client, huerfano)

    with app_module.app.test_request_context('/'):
        from flask_login import login_user
        import blueprints.tasks as tareas
        login_user(db.session.get(User, huerfano))

        visibles = {u.id for u in tareas._unit_user_query().all()}
        assert visibles == {huerfano}, 'no debe ver a los de su rol'

        otro = User.query.filter_by(username='mismo-rol').first()
        assert tareas._assignee_in_current_unit(otro) is False
        assert tareas._assignee_in_current_unit(db.session.get(User, huerfano)) is True
