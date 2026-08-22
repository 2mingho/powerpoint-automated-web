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
from models import User, Report, Area, Task, TempArtifact, Notification, TaskComment, TaskWatcher  # noqa: E402
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
        own_task = db.session.get(Task, own_task_id)
        other_task = db.session.get(Task, other_task_id)

        assert own_task is not None
        assert own_task.deleted_at is not None
        assert other_task is not None
        assert other_task.deleted_at is None

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


# ─────────────────────────────────────────────────────────────
# La pantalla de organizacion
# ─────────────────────────────────────────────────────────────

def test_solo_un_admin_entra_a_organizacion(client):
    with app_module.app.app_context():
        normal = _create_user(username='no-admin', email='no-admin@example.com')

    _login_as(client, normal)
    assert client.get('/admin/organizacion').status_code in (302, 403)


def test_asignar_y_quitar_liderazgo_desde_la_pantalla(client):
    from models import UnitLead

    with app_module.app.app_context():
        area = _create_area('Unidad gestionada')
        jefe = _create_user(username='admin-org', email='admin-org@example.com', role='admin')
        persona = _create_user(username='futura-manager', email='futura-manager@example.com')

    _login_as(client, jefe)

    client.post('/admin/organizacion/lider',
                data={'area_id': area, 'user_id': persona}, follow_redirects=True)
    with app_module.app.app_context():
        assert UnitLead.query.filter_by(area_id=area, user_id=persona).count() == 1

    client.post('/admin/organizacion/lider/quitar',
                data={'area_id': area, 'user_id': persona}, follow_redirects=True)
    with app_module.app.app_context():
        assert UnitLead.query.filter_by(area_id=area, user_id=persona).count() == 0


def test_la_pantalla_rechaza_un_bucle_en_la_cadena(client):
    """Un ciclo no se ve venir desde la interfaz.

    Si el superior elegido ya cuelga de esta persona, asignarlo cierra el
    bucle. El resolvedor lo sobrevive, pero la organizacion no significa nada.
    """
    with app_module.app.app_context():
        jefe = _create_user(username='admin-bucle', email='admin-bucle@example.com', role='admin')
        arriba = _create_user(username='arriba', email='arriba@example.com')
        abajo = _create_user(username='abajo', email='abajo@example.com')
        db.session.get(User, abajo).manager_id = arriba
        db.session.commit()

    _login_as(client, jefe)

    # arriba pasaria a reportar a abajo, que ya cuelga de arriba.
    respuesta = client.post('/admin/organizacion/superior',
                            data={'user_id': arriba, 'manager_id': abajo},
                            follow_redirects=True)

    assert b'bucle' in respuesta.data
    with app_module.app.app_context():
        assert db.session.get(User, arriba).manager_id is None, 'no debio asignarse'


def test_nadie_puede_ser_su_propio_superior(client):
    with app_module.app.app_context():
        jefe = _create_user(username='admin-solo', email='admin-solo@example.com', role='admin')
        persona = _create_user(username='solitario', email='solitario@example.com')

    _login_as(client, jefe)
    client.post('/admin/organizacion/superior',
                data={'user_id': persona, 'manager_id': persona}, follow_redirects=True)

    with app_module.app.app_context():
        assert db.session.get(User, persona).manager_id is None


def test_la_pantalla_muestra_el_alcance_deducido(client):
    """Lo que se configura y lo que se deduce, en la misma pagina."""
    from models import UnitLead

    with app_module.app.app_context():
        area = _create_area('Comunicacion')
        jefe = _create_user(username='admin-vista', email='admin-vista@example.com', role='admin')
        manager = _create_user(username='mgr-vista', email='mgr-vista@example.com')
        director = _create_user(username='dir-vista', email='dir-vista@example.com')
        db.session.add(UnitLead(user_id=manager, area_id=area))
        db.session.get(User, manager).manager_id = director
        db.session.commit()

    _login_as(client, jefe)
    cuerpo = client.get('/admin/organizacion').data.decode()

    assert 'mgr-vista' in cuerpo and 'dir-vista' in cuerpo
    assert 'manager' in cuerpo and 'director' in cuerpo
    assert cuerpo.count('Comunicacion') >= 2, 'la unidad debe salir en el alcance de los dos'


# ─────────────────────────────────────────────────────────────
# Plantillas PowerPoint subibles
# ─────────────────────────────────────────────────────────────

def _pptx_minimo():
    """Un .pptx valido de verdad: zip con Content_Types y una parte ppt/."""
    import io as _io
    import zipfile

    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types/>')
        z.writestr('ppt/presentation.xml', '<p:presentation/>')
    return buf.getvalue()


def test_subir_una_plantilla_la_deja_disponible(client):
    """Sube y aparece en la lista que ve quien genera reportes."""
    import io as _io
    from models import PptxTemplate

    with app_module.app.app_context():
        jefe = _create_user(username='admin-pl', email='admin-pl@example.com', role='admin')

    _login_as(client, jefe)
    respuesta = client.post('/admin/plantillas/subir', data={
        'plantilla': (_io.BytesIO(_pptx_minimo()), 'Reporte_Cliente.pptx'),
    }, content_type='multipart/form-data', follow_redirects=True)

    assert respuesta.status_code == 200
    with app_module.app.app_context():
        guardada = PptxTemplate.query.filter_by(name='Reporte_Cliente.pptx').first()
        assert guardada is not None
        assert guardada.size_bytes > 0
        assert 'Reporte_Cliente.pptx' in app_module.get_available_templates()


def test_un_pptx_falso_se_rechaza(client):
    """Fiarse de la extension deja subir cualquier cosa renombrada."""
    import io as _io
    from models import PptxTemplate

    with app_module.app.app_context():
        jefe = _create_user(username='admin-falso', email='admin-falso@example.com', role='admin')

    _login_as(client, jefe)
    respuesta = client.post('/admin/plantillas/subir', data={
        'plantilla': (_io.BytesIO(b'esto no es un zip'), 'trampa.pptx'),
    }, content_type='multipart/form-data', follow_redirects=True)

    assert 'no es un PowerPoint' in respuesta.data.decode()
    with app_module.app.app_context():
        assert PptxTemplate.query.filter_by(name='trampa.pptx').first() is None


def test_la_subida_gana_a_la_del_repositorio(client):
    """Reemplazar una plantilla del repositorio no debe exigir un despliegue."""
    import io as _io

    with app_module.app.app_context():
        jefe = _create_user(username='admin-gana', email='admin-gana@example.com', role='admin')
        del_repo = app_module._templates_del_repositorio()

    if not del_repo:
        import pytest
        pytest.skip('el repositorio no trae plantillas en este entorno')

    nombre = del_repo[0]
    _login_as(client, jefe)
    client.post('/admin/plantillas/subir', data={
        'plantilla': (_io.BytesIO(_pptx_minimo()), nombre),
    }, content_type='multipart/form-data', follow_redirects=True)

    with app_module.app.app_context():
        abierto = app_module.open_template(nombre)
        assert isinstance(abierto, _io.BytesIO), 'debe venir de la base, no del disco'
        # Y no se duplica en la lista.
        assert app_module.get_available_templates().count(nombre) == 1


def test_solo_un_admin_gestiona_plantillas(client):
    with app_module.app.app_context():
        normal = _create_user(username='no-admin-pl', email='no-admin-pl@example.com')

    _login_as(client, normal)
    assert client.get('/admin/plantillas').status_code in (302, 403)


# ─────────────────────────────────────────────────────────────
# Busqueda de usuarios: tiene que aguantar N usuarios
# ─────────────────────────────────────────────────────────────

def test_la_lista_de_usuarios_pagina(client):
    """Antes hacia .all(): con cientos de usuarios los traia todos."""
    with app_module.app.app_context():
        jefe = _create_user(username='admin-pag', email='admin-pag@example.com', role='admin')
        for i in range(30):
            _create_user(username=f'persona{i:02d}', email=f'persona{i:02d}@example.com')

    _login_as(client, jefe)

    primera = client.get('/admin/users').data.decode()
    assert 'Página 1 de' in primera
    assert primera.count('persona') >= 20, 'debe traer una pagina llena'

    segunda = client.get('/admin/users?p=2').data.decode()
    assert 'Página 2 de' in segunda


def test_buscar_por_nombre_email_unidad_y_estado(client):
    with app_module.app.app_context():
        jefe = _create_user(username='admin-busca', email='admin-busca@example.com', role='admin')
        unidad = _create_area('Unidad buscada')

        encontrada = _create_user(username='aguja', email='aguja@example.com')
        db.session.get(User, encontrada).area_id = unidad
        inactiva = _create_user(username='pajar-inactivo', email='pajar-inactivo@example.com',
                                is_active=False)
        _create_user(username='pajar', email='pajar@example.com')
        db.session.commit()

    _login_as(client, jefe)

    por_nombre = client.get('/admin/users?q=aguja').data.decode()
    assert 'aguja' in por_nombre and 'pajar@example.com' not in por_nombre

    por_unidad = client.get(f'/admin/users?area={unidad}').data.decode()
    assert 'aguja' in por_unidad and '>pajar<' not in por_unidad

    por_estado = client.get('/admin/users?estado=inactivos').data.decode()
    assert 'pajar-inactivo' in por_estado and '>aguja<' not in por_estado

    sin_unidad = client.get('/admin/users?area=sin').data.decode()
    assert 'pajar' in sin_unidad and '>aguja<' not in sin_unidad


def test_los_filtros_sobreviven_al_cambiar_de_pagina(client):
    """Pasar de pagina no puede perder lo que estabas buscando."""
    with app_module.app.app_context():
        jefe = _create_user(username='admin-filtro', email='admin-filtro@example.com', role='admin')
        for i in range(30):
            _create_user(username=f'lote{i:02d}', email=f'lote{i:02d}@example.com')

    _login_as(client, jefe)
    cuerpo = client.get('/admin/users?q=lote').data.decode()

    assert 'q=lote' in cuerpo, 'el enlace a la pagina siguiente debe conservar la busqueda'


# ─────────────────────────────────────────────────────────────
# Catalogo de estados y prioridades
# ─────────────────────────────────────────────────────────────

def _sembrar_catalogo():
    """Lo que deja la revision 0007. Las pruebas crean el esquema con
    create_all(), que no ejecuta el traspaso de la migracion."""
    from models import TaskStatus, TaskPriority

    if TaskStatus.query.count() == 0:
        for nombre, orden, color, ini, fin in [
            ('Pendiente', 10, 'aviso', True, False),
            ('En Progreso', 20, 'info', False, False),
            ('Completado', 50, 'bien', False, True),
        ]:
            db.session.add(TaskStatus(nombre=nombre, orden=orden, color=color,
                                      es_inicial=ini, es_final=fin))
    if TaskPriority.query.count() == 0:
        for nombre, orden, color, defecto in [
            ('Alta', 30, 'alerta', False),
            ('Media', 20, 'aviso', True),
            ('Baja', 10, 'neutro', False),
        ]:
            db.session.add(TaskPriority(nombre=nombre, orden=orden, color=color,
                                        es_defecto=defecto))
    db.session.commit()


def test_el_catalogo_manda_sobre_la_constante(client):
    """Anadir un estado deja de ser un despliegue."""
    from models import TaskStatus
    from services.catalogo import estados_validos, invalidar_cache_catalogo

    with app_module.app.app_context():
        _sembrar_catalogo()
        assert 'Archivado' not in estados_validos()

        db.session.add(TaskStatus(nombre='Archivado', orden=60, color='neutro',
                                  es_inicial=False, es_final=True))
        db.session.commit()
        invalidar_cache_catalogo()

        assert 'Archivado' in estados_validos()


def test_terminado_es_una_bandera_no_un_nombre(client):
    """Renombrar "Completado" no puede romper los vencimientos.

    Si el codigo comparase contra el texto, este renombrado dejaria de contar
    ninguna tarea como terminada.
    """
    from models import TaskStatus
    from services.catalogo import es_estado_final, estados_finales, invalidar_cache_catalogo

    with app_module.app.app_context():
        _sembrar_catalogo()
        assert es_estado_final('Completado')

        final = TaskStatus.query.filter_by(es_final=True).first()
        final.nombre = 'Cerrado'
        db.session.commit()
        invalidar_cache_catalogo()

        assert es_estado_final('Cerrado')
        assert not es_estado_final('Completado')
        assert estados_finales() == ('Cerrado',)


def test_renombrar_arrastra_las_tareas(client):
    """La tarea guarda el nombre: renombrar sin reescribirlas las invalidaria."""
    from services.clock import today_local

    with app_module.app.app_context():
        _sembrar_catalogo()
        jefe = _create_user(username='admin-cat', email='admin-cat@example.com', role='admin')
        tarea_id = _create_task(title='En revision', due_date=today_local(),
                                area='DI', creator_id=jefe, assignee_id=jefe)
        db.session.get(Task, tarea_id).status = 'En Progreso'
        db.session.commit()

        from models import TaskStatus
        estado = TaskStatus.query.filter_by(nombre='En Progreso').first()
        estado_id = estado.id

    _login_as(client, jefe)
    client.post('/admin/catalogo/estado', data={
        'id': estado_id, 'nombre': 'En curso', 'orden': 20, 'color': 'info',
    }, follow_redirects=True)

    with app_module.app.app_context():
        assert db.session.get(Task, tarea_id).status == 'En curso'


def test_no_se_puede_quedar_sin_estado_terminal(client):
    """Sin el, nada contaria nunca como terminado."""
    from models import TaskStatus

    with app_module.app.app_context():
        _sembrar_catalogo()
        jefe = _create_user(username='admin-final', email='admin-final@example.com', role='admin')
        final = TaskStatus.query.filter_by(es_final=True).first()
        final_id = final.id

    _login_as(client, jefe)
    respuesta = client.post('/admin/catalogo/estado', data={
        'id': final_id, 'nombre': 'Completado', 'orden': 50, 'color': 'bien',
        # sin es_final
    }, follow_redirects=True)

    assert 'al menos un estado' in respuesta.data.decode()
    with app_module.app.app_context():
        assert db.session.get(TaskStatus, final_id).es_final is True


def test_no_se_borra_un_estado_en_uso(client):
    from models import TaskStatus
    from services.clock import today_local

    with app_module.app.app_context():
        _sembrar_catalogo()
        jefe = _create_user(username='admin-uso', email='admin-uso@example.com', role='admin')
        _create_task(title='Ocupa el estado', due_date=today_local(),
                     area='DI', creator_id=jefe, assignee_id=jefe)
        estado_id = TaskStatus.query.filter_by(nombre='Pendiente').first().id

    _login_as(client, jefe)
    respuesta = client.post(f'/admin/catalogo/estado/{estado_id}/eliminar', follow_redirects=True)

    assert 'No se puede eliminar' in respuesta.data.decode()
    with app_module.app.app_context():
        assert db.session.get(TaskStatus, estado_id) is not None


def test_solo_hay_un_estado_inicial(client):
    from models import TaskStatus

    with app_module.app.app_context():
        _sembrar_catalogo()
        jefe = _create_user(username='admin-ini', email='admin-ini@example.com', role='admin')
        otro = TaskStatus.query.filter_by(nombre='En Progreso').first()
        otro_id = otro.id

    _login_as(client, jefe)
    client.post('/admin/catalogo/estado', data={
        'id': otro_id, 'nombre': 'En Progreso', 'orden': 20, 'color': 'info',
        'es_inicial': 'on',
    }, follow_redirects=True)

    with app_module.app.app_context():
        iniciales = TaskStatus.query.filter_by(es_inicial=True).all()
        assert len(iniciales) == 1
        assert iniciales[0].id == otro_id


def test_solo_un_admin_edita_el_catalogo(client):
    with app_module.app.app_context():
        _sembrar_catalogo()
        normal = _create_user(username='no-admin-cat', email='no-admin-cat@example.com')

    _login_as(client, normal)
    assert client.get('/admin/catalogo').status_code in (302, 403)


# Colaboracion en tareas: borrado suave, conflictos, notificaciones,
# comentarios y observadores
# ─────────────────────────────────────────────────────────────


def test_soft_deleted_task_hidden_from_api(client):
    target_day = date(2026, 2, 10)

    with app_module.app.app_context():
        user_id = _create_user(
            username='tasks-owner',
            email='tasks-owner@example.com',
            role='DI',
            tools=['tasks'],
        )
        task_id = _create_task(
            title='Tarea oculta por soft delete',
            due_date=target_day,
            area='DI',
            creator_id=user_id,
            assignee_id=user_id,
        )

    _login_as(client, user_id)

    delete_response = client.delete(f'/api/tasks/{task_id}')
    assert delete_response.status_code == 200
    assert delete_response.get_json()['success'] is True

    list_response = client.get(f'/api/tasks?start={target_day.isoformat()}&end={target_day.isoformat()}')
    assert list_response.status_code == 200
    assert list_response.get_json() == []

    with app_module.app.app_context():
        task = db.session.get(Task, task_id)
        assert task is not None
        assert task.deleted_at is not None
        assert task.deleted_by_id == user_id


def test_update_conflict_returns_409(client):
    target_day = date(2026, 2, 11)

    with app_module.app.app_context():
        user_id = _create_user(
            username='tasks-editor',
            email='tasks-editor@example.com',
            role='DI',
            tools=['tasks'],
        )
        task_id = _create_task(
            title='Tarea con conflicto',
            due_date=target_day,
            area='DI',
            creator_id=user_id,
            assignee_id=user_id,
        )
        task = db.session.get(Task, task_id)
        stale_updated_at = task.updated_at.isoformat()
        task.title = 'Título cambiado en otra sesión'
        db.session.commit()

    _login_as(client, user_id)
    response = client.put(f'/api/tasks/{task_id}', json={
        'title': 'Mi cambio viejo',
        'expected_updated_at': stale_updated_at,
    })

    assert response.status_code == 409
    payload = response.get_json()
    assert payload['success'] is False
    assert 'modificada por otro usuario' in payload['error']
    assert payload['task']['title'] == 'Título cambiado en otra sesión'


def test_notifications_are_user_scoped(client):
    with app_module.app.app_context():
        owner_id = _create_user(username='notif-owner', email='notif-owner@example.com')
        other_id = _create_user(username='notif-other', email='notif-other@example.com')

        owner_notif = Notification(user_id=owner_id, kind='task_assigned', title='Notif owner')
        other_notif = Notification(user_id=other_id, kind='task_assigned', title='Notif other')
        db.session.add_all([owner_notif, other_notif])
        db.session.commit()
        owner_notif_id = owner_notif.id
        other_notif_id = other_notif.id

    _login_as(client, owner_id)

    list_response = client.get('/api/notifications')
    assert list_response.status_code == 200
    payload = list_response.get_json()
    assert payload['success'] is True
    assert [item['id'] for item in payload['items']] == [owner_notif_id]

    own_read_response = client.post(f'/api/notifications/{owner_notif_id}/read')
    assert own_read_response.status_code == 200
    assert own_read_response.get_json()['success'] is True

    other_read_response = client.post(f'/api/notifications/{other_notif_id}/read')
    assert other_read_response.status_code == 404

    with app_module.app.app_context():
        owner_notif = db.session.get(Notification, owner_notif_id)
        other_notif = db.session.get(Notification, other_notif_id)
        assert owner_notif.read_at is not None
        assert other_notif.read_at is None


def test_comments_respect_unit_scope(client):
    with app_module.app.app_context():
        area_a_id = _create_area('Area-C1')
        area_b_id = _create_area('Area-C2')
        owner_id = _create_user(username='comment-owner', email='comment-owner@example.com', tools=['tasks'])
        other_id = _create_user(username='comment-other', email='comment-other@example.com', tools=['tasks'])
        owner = db.session.get(User, owner_id)
        other = db.session.get(User, other_id)
        owner.area_id = area_a_id
        other.area_id = area_b_id
        db.session.commit()
        task_id = _create_task(title='Tarea comentarios', due_date=date(2026, 2, 12), area='DI', creator_id=owner_id, assignee_id=owner_id)

    _login_as(client, other_id)
    response = client.get(f'/api/tasks/{task_id}/comments')
    assert response.status_code == 403


def test_mention_notifies_unit_user_only(client):
    with app_module.app.app_context():
        area_a_id = _create_area('Area-M1')
        area_b_id = _create_area('Area-M2')
        author_id = _create_user(username='author-user', email='author-user@example.com', tools=['tasks'])
        same_unit_id = _create_user(username='same.unit', email='same@example.com', tools=['tasks'])
        other_unit_id = _create_user(username='other.unit', email='other@example.com', tools=['tasks'])
        author = db.session.get(User, author_id)
        same_unit = db.session.get(User, same_unit_id)
        other_unit = db.session.get(User, other_unit_id)
        author.area_id = area_a_id
        same_unit.area_id = area_a_id
        other_unit.area_id = area_b_id
        db.session.commit()
        task_id = _create_task(title='Tarea mención', due_date=date(2026, 2, 13), area='DI', creator_id=author_id, assignee_id=author_id)

    _login_as(client, author_id)
    response = client.post(f'/api/tasks/{task_id}/comments', json={'body': 'Hola @same.unit y @other.unit'})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True

    with app_module.app.app_context():
        same_notifs = Notification.query.filter_by(user_id=same_unit_id, kind='mention').all()
        other_notifs = Notification.query.filter_by(user_id=other_unit_id, kind='mention').all()
        comments = TaskComment.query.filter_by(task_id=task_id).all()
        assert len(same_notifs) == 1
        assert len(other_notifs) == 0
        assert len(comments) == 1


def test_watcher_can_view_but_not_edit_shared_task(client):
    with app_module.app.app_context():
        area_a_id = _create_area('Area-W1')
        area_b_id = _create_area('Area-W2')
        owner_id = _create_user(username='watch-owner', email='watch-owner@example.com', tools=['tasks'])
        watcher_id = _create_user(username='watch-user', email='watch-user@example.com', tools=['tasks'])
        owner = db.session.get(User, owner_id)
        watcher = db.session.get(User, watcher_id)
        owner.area_id = area_a_id
        watcher.area_id = area_b_id
        db.session.commit()

        task_id = _create_task(
            title='Tarea shared watcher',
            due_date=date(2026, 2, 14),
            area='DI',
            creator_id=owner_id,
            assignee_id=owner_id,
        )
        task = db.session.get(Task, task_id)
        task.visibility = 'shared'
        db.session.add(TaskWatcher(task_id=task_id, user_id=watcher_id, added_by_id=owner_id))
        db.session.commit()

    _login_as(client, watcher_id)

    get_response = client.get(f'/api/tasks/{task_id}')
    assert get_response.status_code == 200
    payload = get_response.get_json()
    assert payload['success'] is True
    assert payload['task']['can_edit'] is False

    comments_response = client.get(f'/api/tasks/{task_id}/comments')
    assert comments_response.status_code == 200

    update_response = client.put(f'/api/tasks/{task_id}', json={'title': 'No debe editar'})
    assert update_response.status_code == 403

    comment_response = client.post(f'/api/tasks/{task_id}/comments', json={'body': 'No debe comentar'})
    assert comment_response.status_code == 403


def test_unit_visibility_unchanged_for_non_watchers(client):
    with app_module.app.app_context():
        area_a_id = _create_area('Area-U1')
        area_b_id = _create_area('Area-U2')
        owner_id = _create_user(username='unit-owner', email='unit-owner@example.com', tools=['tasks'])
        outsider_id = _create_user(username='unit-outsider', email='unit-outsider@example.com', tools=['tasks'])
        owner = db.session.get(User, owner_id)
        outsider = db.session.get(User, outsider_id)
        owner.area_id = area_a_id
        outsider.area_id = area_b_id
        db.session.commit()

        task_id = _create_task(
            title='Tarea shared sin watcher',
            due_date=date(2026, 2, 15),
            area='DI',
            creator_id=owner_id,
            assignee_id=owner_id,
        )
        task = db.session.get(Task, task_id)
        task.visibility = 'shared'
        db.session.commit()

    _login_as(client, outsider_id)
    get_response = client.get(f'/api/tasks/{task_id}')
    assert get_response.status_code == 403


def test_can_add_and_remove_watcher(client):
    with app_module.app.app_context():
        area_id = _create_area('Area-W3')
        owner_id = _create_user(username='owner-add-watch', email='owner-add-watch@example.com', tools=['tasks'])
        watcher_id = _create_user(username='watch-add-user', email='watch-add-user@example.com', tools=['tasks'])
        owner = db.session.get(User, owner_id)
        watcher = db.session.get(User, watcher_id)
        owner.area_id = area_id
        watcher.area_id = area_id
        db.session.commit()
        task_id = _create_task(title='Tarea add watcher', due_date=date(2026, 2, 16), area='DI', creator_id=owner_id, assignee_id=owner_id)

    _login_as(client, owner_id)
    add_response = client.post(f'/api/tasks/{task_id}/watchers', json={'user_id': watcher_id})
    assert add_response.status_code == 200
    assert add_response.get_json()['success'] is True

    with app_module.app.app_context():
        watcher = TaskWatcher.query.filter_by(task_id=task_id, user_id=watcher_id).first()
        assert watcher is not None

    remove_response = client.delete(f'/api/tasks/{task_id}/watchers/{watcher_id}')
    assert remove_response.status_code == 200
    assert remove_response.get_json()['success'] is True

    with app_module.app.app_context():
        watcher = TaskWatcher.query.filter_by(task_id=task_id, user_id=watcher_id).first()
        assert watcher is None


def test_add_cross_area_watcher_sets_shared_visibility(client):
    with app_module.app.app_context():
        area_a_id = _create_area('Area-W4A')
        area_b_id = _create_area('Area-W4B')
        owner_id = _create_user(username='owner-cross-watch', email='owner-cross-watch@example.com', tools=['tasks'])
        watcher_id = _create_user(username='watch-cross-user', email='watch-cross-user@example.com', tools=['tasks'])
        owner = db.session.get(User, owner_id)
        watcher = db.session.get(User, watcher_id)
        owner.area_id = area_a_id
        watcher.area_id = area_b_id
        db.session.commit()
        task_id = _create_task(title='Tarea cross watcher', due_date=date(2026, 2, 17), area='DI', creator_id=owner_id, assignee_id=owner_id)

    _login_as(client, owner_id)
    add_response = client.post(f'/api/tasks/{task_id}/watchers', json={'user_id': watcher_id})
    assert add_response.status_code == 200

    with app_module.app.app_context():
        task = db.session.get(Task, task_id)
        assert task.visibility == 'shared'


# ─────────────────────────────────────────────────────────────
# FUN-01: el vencimiento se mide con el reloj del equipo, no del servidor
# ─────────────────────────────────────────────────────────────


def test_overdue_uses_business_timezone_not_server_utc():
    """
    Republica Dominicana es UTC-4 todo el ano. A las 02:00 UTC del dia D en el
    servidor, para el equipo son las 22:00 del dia D-1: aun les quedan dos horas
    de ese dia. Con date.today() (UTC) una tarea que vence el dia D-1 ya contaba
    como vencida; con la zona de negocio, no.
    """
    from datetime import datetime, timezone, timedelta
    from services.clock import APP_TIMEZONE

    utc_moment = datetime(2026, 3, 11, 2, 0, tzinfo=timezone.utc)
    local_moment = utc_moment.astimezone(APP_TIMEZONE)

    assert local_moment.date() == utc_moment.date() - timedelta(days=1), (
        'La zona de negocio deberia ir por detras de UTC en la madrugada; '
        f'APP_TIMEZONE resolvio a {APP_TIMEZONE}'
    )
    assert local_moment.hour == 22

    # El comportamiento anterior (fecha del servidor) marcaba vencida una tarea
    # que para el equipo todavia vence hoy.
    due = local_moment.date()
    assert due < utc_moment.date(), 'con UTC salia vencida'
    assert not (due < local_moment.date()), 'con la zona de negocio, no'


def test_task_is_overdue_respects_local_today(client):
    from services.clock import today_local

    with app_module.app.app_context():
        user_id = _create_user(username='tz-user', email='tz-user@example.com', tools=['tasks'])
        # Vence hoy segun el reloj del equipo: nunca debe salir como vencida
        task_id = _create_task(title='Vence hoy', due_date=today_local(),
                               area='DI', creator_id=user_id, assignee_id=user_id)

    with app_module.app.app_context():
        task = db.session.get(Task, task_id)
        assert task.to_dict()['is_overdue'] is False


# ─────────────────────────────────────────────────────────────
# Proteccion de la base de produccion en arranques locales
# ─────────────────────────────────────────────────────────────

def _with_uri(uri, production):
    """Evalua el predicado de arranque con una URI y un modo dados."""
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
    arranque cree tablas, siembre el admin o ejecute la poda (que BORRA logs de
    actividad, metadatos de reportes y tareas con borrado logico).
    """
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=False) is False


def test_startup_writes_allowed_on_local_sqlite():
    assert _with_uri('sqlite:///instance/users.db', production=False) is True


def test_startup_writes_allowed_in_production():
    """En produccion el arranque si siembra el admin en el primer despliegue."""
    assert _with_uri('postgresql://u:p@ep-x.neon.tech/main', production=True) is True


# ─────────────────────────────────────────────────────────────
# Las puertas del panel de equipo
# ─────────────────────────────────────────────────────────────

def test_el_director_entra_al_panel_sin_liderar_ninguna_unidad(client):
    """El caso que motivo la migracion entera.

    Con is_area_lead, un director recibia 403 antes de ejecutar consulta
    alguna: el booleano significaba "lidero la unidad a la que pertenezco".
    """
    from models import UnitLead

    with app_module.app.app_context():
        area = _create_area('Unidad del manager')
        manager = _create_user(username='mgr-puerta', email='mgr-puerta@example.com',
                               tools=['tasks'])
        director = _create_user(username='dir-puerta', email='dir-puerta@example.com',
                                tools=['tasks'])
        db.session.add(UnitLead(user_id=manager, area_id=area))
        db.session.get(User, manager).manager_id = director
        db.session.commit()

    _login_as(client, director)
    respuesta = client.get('/api/team/tasks')

    assert respuesta.status_code == 200, respuesta.data
    assert respuesta.get_json()['success'] is True


def test_el_empleado_sigue_fuera_del_panel(client):
    """Cierra en falso: sin nada que supervisar, no se entra."""
    with app_module.app.app_context():
        area = _create_area('Unidad ajena')
        empleado = _create_user(username='empleado-puerta', email='empleado-puerta@example.com',
                                tools=['tasks'])
        db.session.get(User, empleado).area_id = area
        db.session.commit()

    _login_as(client, empleado)

    assert client.get('/api/team/tasks').status_code == 403
    assert client.get('/tasks/team-dashboard').status_code == 403


def test_aceptar_una_solicitud_exige_liderar_la_unidad_destino(client):
    """La comprobacion mas sensible de las cuarenta.

    Pertenecer a la unidad destino no basta: hay que liderarla. Y debe fallar
    aunque la interfaz no muestre el boton, porque un POST llega igual.
    """
    from models import TaskRequest, UnitLead

    with app_module.app.app_context():
        origen = _create_area('Unidad origen')
        destino = _create_area('Unidad destino')

        solicitante = _create_user(username='pide', email='pide@example.com', tools=['tasks'])
        db.session.get(User, solicitante).area_id = origen

        # Pertenece al destino pero no lo lidera.
        miembro = _create_user(username='miembro', email='miembro@example.com', tools=['tasks'])
        db.session.get(User, miembro).area_id = destino

        lider = _create_user(username='lidera-destino', email='lidera-destino@example.com',
                             tools=['tasks'])
        db.session.add(UnitLead(user_id=lider, area_id=destino))

        req = TaskRequest(title='Piezas', requester_id=solicitante,
                          from_area_id=origen, to_area_id=destino, status='Pendiente')
        db.session.add(req)
        db.session.commit()
        req_id = req.id

    _login_as(client, miembro)
    assert client.post(f'/api/task-requests/{req_id}/accept', json={}).status_code == 403

    # Quien lidera si acepta, y asigna a alguien de la unidad destino. El lider
    # no pertenece a ella —lidera sin ser miembro—, asi que no puede asignarse
    # la tarea a si mismo: eso lo decide el endpoint, no el alcance.
    _login_as(client, lider)
    respuesta = client.post(f'/api/task-requests/{req_id}/accept',
                            json={'assignee_id': miembro, 'due_date': '2026-09-01'})
    assert respuesta.status_code == 200, respuesta.data


# ─────────────────────────────────────────────────────────────
# La lista blanca: que nadie vuelva a resolver el alcance a mano
# ─────────────────────────────────────────────────────────────

def _funciones_que_leen(patron, ficheros):
    """Devuelve (fichero, funcion) por cada lectura del patron.

    Se ancla a la funcion y no al numero de linea, para que no chille cada vez
    que alguien anade una linea encima.
    """
    import re
    encontrados = set()
    for ruta in ficheros:
        with open(ruta, encoding='utf-8') as fh:
            actual = '<modulo>'
            for linea in fh:
                m = re.match(r'^\s*def (\w+)', linea)
                if m:
                    actual = m.group(1)
                sin_comentario = linea.split('#', 1)[0]
                if patron in sin_comentario:
                    encontrados.add((ruta, actual))
    return encontrados


def test_solo_la_pertenencia_lee_area_id():
    """Leer current_user.area_id significa pertenencia, nunca alcance.

    Si esta prueba falla por una funcion nueva, no esta rota: alguien resolvio
    un alcance a mano y debe pasar por services/alcance.py. Y falla en los dos
    sentidos: tambien avisa si una de las permitidas deja de leerla, que suele
    significar que se migro algo que no tocaba.
    """
    PERMITIDAS = {
        ('blueprints/tasks.py', 'api_templates_create'),
        ('blueprints/tasks.py', 'api_templates_instantiate'),
        ('blueprints/task_requests.py', 'api_task_requests_create'),
    }

    encontradas = _funciones_que_leen(
        'current_user.area_id',
        ['blueprints/tasks.py', 'blueprints/task_requests.py', 'app.py'],
    )

    assert encontradas == PERMITIDAS, (
        f'sobran: {sorted(encontradas - PERMITIDAS)} | faltan: {sorted(PERMITIDAS - encontradas)}')


def test_nadie_decide_permisos_con_is_area_lead():
    """La columna sobrevive para que la lea la migracion, no el codigo.

    Se retirara en su propia migracion cuando ya no quede ninguna lectura.
    """
    encontradas = _funciones_que_leen(
        'is_area_lead',
        ['blueprints/tasks.py', 'blueprints/task_requests.py', 'templates/base.html'],
    )
    assert encontradas == set(), f'siguen leyendola: {sorted(encontradas)}'


# Rediseno: vista Hoy y navegacion en dos espacios
# ─────────────────────────────────────────────────────────────

def test_tasks_page_publishes_business_today(client):
    """La vista Hoy agrupa por dia usando el dia que fija el servidor.

    Si se cayera a `data-hoy` vacio o al reloj del navegador, quien se conecte
    desde otro huso veria el grupo equivocado y tareas vencidas que no lo estan.
    """
    from services.clock import today_local

    with app_module.app.app_context():
        user_id = _create_user(username='hoy-user', email='hoy-user@example.com', tools=['tasks'])
        esperado = today_local().isoformat()

    _login_as(client, user_id)
    response = client.get('/tasks')

    assert response.status_code == 200
    assert f'data-hoy="{esperado}"'.encode() in response.data


def test_sidebar_hides_work_space_without_tasks_access(client):
    """Un espacio sin entradas visibles no debe dibujar su boton.

    Quien no tiene tareas no gana un conmutador que solo lleva a un 403.
    """
    with app_module.app.app_context():
        user_id = _create_user(username='solo-tools', email='solo-tools@example.com',
                               tools=['reports'])

    _login_as(client, user_id)
    response = client.get('/menu')
    cuerpo = response.data.decode()

    assert response.status_code == 200
    assert 'sidebar-spaces' not in cuerpo
    assert 'data-espacio="trabajo"' not in cuerpo
    assert 'Generar Reporte' in cuerpo


# ─────────────────────────────────────────────────────────────
# Rediseno: indicadores de cabecera del dashboard (RED-7)
# ─────────────────────────────────────────────────────────────

def test_headline_stats_count_overdue_and_blocked(client):
    """Los indicadores cuentan lo que dicen contar.

    'Vencidas' excluye las completadas: una tarea entregada tarde ya no es un
    problema abierto y contarla inflaria el numero que dispara la accion.
    """
    from datetime import timedelta
    from services.clock import today_local

    with app_module.app.app_context():
        user_id = _create_user(username='kpi-user', email='kpi-user@example.com',
                               role='admin', tools=['tasks'])
        ayer = today_local() - timedelta(days=1)

        _create_task(title='Vencida y abierta', due_date=ayer,
                     area='DI', creator_id=user_id, assignee_id=user_id)

        completada_id = _create_task(title='Vencida pero completada', due_date=ayer,
                                     area='DI', creator_id=user_id, assignee_id=user_id)
        db.session.get(Task, completada_id).status = 'Completado'

        bloqueada_id = _create_task(title='Bloqueada', due_date=today_local() + timedelta(days=5),
                                    area='DI', creator_id=user_id, assignee_id=user_id)
        db.session.get(Task, bloqueada_id).status = 'Bloqueado'
        db.session.commit()

    _login_as(client, user_id)
    payload = client.get('/api/admin/tasks').get_json()

    assert payload['success'] is True
    assert payload['stats']['vencidas'] == 1
    assert payload['stats']['bloqueadas'] == 1
    assert payload['stats']['carga_max'] == 2  # las dos abiertas del mismo usuario
    assert payload['stats']['carga_max_nombre'] == 'kpi-user'


def test_overdue_filter_narrows_the_dashboard_table(client):
    """Pulsar el indicador debe llevar a la tabla ya filtrada.

    Sin este parametro el numero seria decorativo: habria que reconstruir el
    filtro a mano, que es justo lo que RED-7 elimina.
    """
    from datetime import timedelta
    from services.clock import today_local

    with app_module.app.app_context():
        user_id = _create_user(username='kpi-filtro', email='kpi-filtro@example.com',
                               role='admin', tools=['tasks'])
        _create_task(title='Ya vencio', due_date=today_local() - timedelta(days=3),
                     area='DI', creator_id=user_id, assignee_id=user_id)
        _create_task(title='Vence pronto', due_date=today_local() + timedelta(days=3),
                     area='DI', creator_id=user_id, assignee_id=user_id)

    _login_as(client, user_id)

    todas = client.get('/api/admin/tasks').get_json()['tasks']
    vencidas = client.get('/api/admin/tasks?overdue=1').get_json()['tasks']

    assert len(todas) == 2
    assert [t['title'] for t in vencidas] == ['Ya vencio']
