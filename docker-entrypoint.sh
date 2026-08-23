#!/bin/sh
# Punto de entrada del contenedor.
#
# El esquema lo gobierna Alembic y en produccion `ensure_schema()` no crea ni
# altera nada a proposito (app.py). Hasta ahora el CMD arrancaba gunicorn a
# secas, asi que las migraciones dependian de que alguien las corriera a mano
# tras cada despliegue. Cuando no ocurrio, produccion quedo con el codigo
# nuevo y el esquema viejo: sin las tablas ai_providers/ai_usage, configurar
# las conexiones de IA daba error y generar un reporte tambien.
#
# Migrar aqui, una sola vez y antes de levantar los workers, hace que el
# despliegue no pueda olvidarse. Si la migracion falla, el contenedor no
# arranca: preferible a servir con un esquema equivocado.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
    echo "[entrypoint] aplicando migraciones..."
    flask db upgrade
    echo "[entrypoint] esquema al dia."
fi

exec gunicorn --bind "0.0.0.0:${PORT:-5000}" \
     --workers "${WEB_CONCURRENCY:-1}" \
     --threads "${GUNICORN_THREADS:-4}" \
     --timeout "${GUNICORN_TIMEOUT:-180}" \
     app:app
