FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    FORCE_PRODUCTION_MODE=true \
    MPLBACKEND=Agg \
    PORT=5000

WORKDIR /app

# curl entra solo para la sonda de salud del HEALTHCHECK de mas abajo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x docker-entrypoint.sh \
    && mkdir -p scratch instance powerpoints \
    && adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

# El arranque aplica las migraciones antes de levantar gunicorn, asi que el
# primer boot tarda: start-period le da margen sin contar esos intentos como
# fallos. Despues, tres sondas seguidas en rojo bastan para sacar el contenedor
# del balanceador en vez de seguir mandandole trafico.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-5000}/healthz" || exit 1

CMD ["./docker-entrypoint.sh"]
