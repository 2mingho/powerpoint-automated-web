# Despliegue y corte de Flask

Dos servicios, una base de datos.

| Servicio | Imagen | Puerto | Qué hace | Público |
|---|---|---|---|---|
| **web** (Next.js) | `web/Dockerfile` | 3000 | Toda la interfaz y la API de la aplicación | **Sí** |
| **analisis** (Flask) | `Dockerfile` (raíz) | 5000 | `/api/interno` (reportes, clasificación, unión y análisis de CSV), `/healthz` y **las migraciones** | No: solo la ve `web` |

La base es PostgreSQL. **Alembic (Flask) es el único dueño del esquema**: `web` solo lo lee y nunca migra.

## Orden de un despliegue

1. **Primero `analisis`.** Su `docker-entrypoint.sh` corre `flask db upgrade` antes de arrancar; si falla, no arranca.
2. **Después `web`.** Su `/healthz` devuelve **503 mientras el esquema esté atrasado** (la base está en una revisión anterior a la que espera el código), así que el orquestador no le manda tráfico antes de tiempo. Una base *por delante* (otra versión ya migró) sigue sirviendo: las migraciones son aditivas.
3. Al añadir una migración, añade su revisión a `HISTORIAL` en `web/src/lib/esquema.ts`; una prueba compara esa lista con `migrations/versions` y falla si se olvida.

**Marcha atrás de `web`:** volver a la imagen anterior es seguro porque el esquema solo crece. **De una migración:** `flask db downgrade` a mano, y solo si nada nuevo escribió en lo que se quita (contratos, metas, permisos de ingresos).

## `web`

```
docker build -t newlink-web web/
docker run -p 3000:3000 --env-file web.env newlink-web
```

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | PostgreSQL (la misma que `analisis`). Obligatoria |
| `SESSION_SECRET` | Sella las cookies de sesión: 32 caracteres o más, secreto. Cambiarlo cierra todas las sesiones. Obligatoria |
| `ANALYTICS_URL` | **Raíz** de `analisis` (p. ej. `http://analisis:5000`), sin `/api/interno` |
| `ANALYTICS_TOKEN` | Mismo valor que en `analisis`: es la llave entre servicios |
| `ADMIN_EMAIL` | Cuenta de administración principal (no se edita y es la única que puede *ver como* otra persona). Por defecto `admin@dataintel.com` |
| `HEALTHZ_DB_TTL` | Segundos de actividad tras los que `/healthz` deja de preguntar a la base (por defecto 120; 0 = siempre) |
| `PLANTILLAS_DIR` | Carpeta con las plantillas `.pptx` del repositorio, solo para listarlas en Administración |
| `GROQ_API_KEY` | Solo si se usan los textos con IA del reporte |
| `PORT` | Por defecto 3000 |

**Detrás de un proxy** (obligatorio en producción): debe añadir la IP real al final de `X-Forwarded-For` (o fijar `X-Real-IP`). Los límites de intentos de acceso y el registro de actividad la leen de ahí; sin proxy cualquier cliente podría falsearla. Termina TLS en el proxy: la imagen habla HTTP.

### `/healthz`

`200 {"status":"ok","database":"reachable"|"idle","schema":"ok"}` o `503`. No tiene sesión ni expone versiones. Para no mantener despierta la base (Neon cobra por tiempo activo) **solo la consulta si hubo actividad real** en los últimos `HEALTHZ_DB_TTL` segundos, y como mucho cada 30 s; sin actividad responde `idle` sin tocarla. Tras un fallo reintenta cada 5 s.

## `analisis` (Flask)

Variables como hasta ahora (`DATABASE_URL`, `SECRET_KEY`, `ANALYTICS_TOKEN`…). El interruptor del corte:

| Variable | Efecto |
|---|---|
| `FLASK_SOLO_INTERNO=1` | Todo lo que no sea `/api/interno/*` ni `/healthz` responde **404**. Es la forma de apagar la interfaz vieja sin tocar código y **reversible**: quitando la variable vuelve |

## Corte gradual

1. **Preparar (hecho en el código).** La app web iguala a Flask: tareas, solicitudes, Equipo, administración, datos, *ver como*, borrado por día, observadas, clientes.
2. **Poner `web` delante.** `web` pública; `analisis` solo accesible desde `web` (red privada). Los usuarios entran por `web` con la misma contraseña (los hashes son compatibles); las sesiones de Flask no se trasladan: volverán a iniciar sesión una vez.
   - Verificar: acceso, una tarea (crear, cerrar una recurrente), un reporte completo (sube widgets, progreso, descarga), Administración → Personas, `/healthz` en 200.
3. **Apagar la interfaz de Flask:** `FLASK_SOLO_INTERNO=1` en `analisis`. Si algo falla, se quita la variable.
4. **Tras unas semanas estables, borrar código muerto** de Flask (irreversible, por eso va al final): los blueprints `auth`, `admin`, `notifications`, `tasks`, `tablero`, `task_requests` y `tour`, `templates/`, `static/` y las rutas de página de `app.py`. **Se conserva:** `models.py`, `migrations/`, `services/` (análisis), `pptx_builder/`, `blueprints/interno.py` y `/healthz`.

### Qué cambia para quien usa la aplicación

- Cerrar una tarea recurrente crea la siguiente (antes la serie se precalculaba). Cerrar desde Flask una serie creada en la app nueva **no** crea la siguiente: otro motivo para no mantener las dos interfaces abiertas a la vez.
- La suplantación es solo de la cuenta principal y deja marca en la actividad.
