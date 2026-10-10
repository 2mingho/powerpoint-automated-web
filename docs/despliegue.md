# Despliegue y corte de Flask

> **Coolify sobre Hostinger (producción actual): ver [«Coolify»](#coolify-sobre-hostinger).** El resto del documento describe los dos servicios y el corte, sirvan donde se sirvan.

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
| `DB_POOL_MAX` | Conexiones a la base por proceso (por defecto 10). Con una base que limita conexiones, baja este número |
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

## Coolify sobre Hostinger

Se despliega **un solo servicio de tipo Docker Compose** con [`docker-compose.coolify.yml`](../docker-compose.coolify.yml), en vez de dos aplicaciones sueltas. Razones: (1) `web` declara `depends_on: analisis (service_healthy)` y `analisis` migra al arrancar, así que **el orden «primero el esquema, después la web» lo garantiza el compose** y no depende de lanzar dos despliegues a mano; (2) se hablan por nombre dentro de la red del stack (`http://analisis:5000`), sin salir a internet; (3) `analisis` no tiene dominio ni puerto publicado: solo la web es accesible.

Probado en local con Docker Compose contra una base **vacía**: Flask migró de la 0001 a la 0018, `web` esperó a que estuviera sano, `/healthz` dio 200 con `schema: ok`, `analisis` no quedó publicado, y el administrador creado por Flask entró por la web. **No pude probar Coolify en sí** (no tengo acceso a su instancia): lo marcado con «verifica» depende de tu versión de Coolify.

### Alta del servicio

1. **New Resource → Docker Compose** (repositorio Git), rama de producción, *Base Directory* `/`, *Docker Compose Location* `/docker-compose.coolify.yml`.
2. **Environment Variables:** las obligatorias son `DATABASE_URL`, `SECRET_KEY`, `SESSION_SECRET`, `ANALYTICS_TOKEN` y `ADMIN_PASSWORD` (Coolify las pide porque el compose usa `${VAR:?}`). `SESSION_SECRET` es nueva (la web sella con ella sus cookies: 32+ caracteres, secreta); el resto ya las tienes de la Flask actual. `ADMIN_EMAIL` solo si no es `admin@dataintel.com`.
3. **Dominio:** asígnalo al servicio **`web`**, puerto **3000** (verifica que tu versión lo muestre: el compose lleva `SERVICE_FQDN_WEB_3000`, la variable mágica de Coolify para eso). **No asignes dominio a `analisis`.**
4. **Healthchecks:** salen de las imágenes (`/healthz`); Coolify los usa para decidir cuándo el contenedor nuevo reemplaza al viejo.

### Pasar de la Flask actual a este servicio (sin cortar a nadie)

1. **No toques el recurso actual.** Déjalo corriendo.
2. Crea el servicio nuevo con un **dominio temporal** (p. ej. `nuevo.tudominio.com`), contra la **misma base**. Es seguro: la migración es aditiva y la Flask vieja sigue funcionando con las tablas nuevas.
3. Prueba en el dominio temporal (lista de comprobación del corte, más arriba). Las personas entran con su misma contraseña; las sesiones de la Flask vieja no se trasladan, así que cada una vuelve a iniciar sesión una vez.
4. **Cambio de dominio:** quita el dominio de producción del recurso viejo, **detenlo sin borrarlo**, y ponlo en `web` del servicio nuevo. Coolify emite el certificado solo.
5. **Marcha atrás:** vuelve a poner el dominio en el recurso viejo y arráncalo. Mantenlo parado, no borrado, unas semanas.
6. Pasadas esas semanas, borra el recurso viejo y entonces sí la fase 4 del corte (código muerto de Flask).

### Cosas que conviene saber

- **Memoria al construir.** `next build` + `pandas` en un VPS pequeño pueden quedarse sin RAM (el build de Next llega a ~1.5–2 GB). Si el despliegue muere sin error claro, añade swap al VPS o construye las imágenes fuera (GitHub Actions) y despliega con *Docker Image* en vez de *Git*.
- **IP real del cliente.** Los límites de intentos de acceso y el registro de actividad usan **la última entrada de `X-Forwarded-For`**. Con el Traefik de Coolify de cara a internet, esa es la IP del cliente. **Si pones Cloudflare delante**, la última entrada es la de Cloudflare: todos compartirían límite. Habría que fijar `X-Real-IP` desde `CF-Connecting-IP` en el proxy (dímelo y se ajusta).
- **Subidas grandes.** `/api/datos` admite hasta 200 MB y el análisis tarda: Traefik no limita el cuerpo, pero revisa los tiempos de lectura del proxy si una subida larga se corta.
- **Una sola copia de `analisis`.** Su registro de trabajos vive en la memoria del proceso (`WEB_CONCURRENCY=1`, una réplica). `web` sí puede escalar.
- **Base de datos.** Usa la misma cadena de conexión que usa Flask hoy. Con Neon, `/healthz` no la despierta (solo la consulta si hubo actividad real). Si ves «too many connections», baja `DB_POOL_MAX`.
- **`FLASK_SOLO_INTERNO`.** En el compose viene a `1` por defecto: `analisis` no sirve pantallas. Para marcha atrás de emergencia, ponla a `0`.
