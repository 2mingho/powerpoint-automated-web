# Imagen de la aplicacion web (Next.js). El contexto de construccion es web/.
#
#   docker build -t newlink-web web/
#   docker run -p 3000:3000 -e DATABASE_URL=... -e SESSION_SECRET=... -e ANALYTICS_URL=... -e ANALYTICS_TOKEN=... newlink-web
#
# La aplicacion NO migra la base: el esquema lo gobierna Alembic y lo aplica la imagen de
# Flask (docker-entrypoint.sh) al arrancar. Despliega esa primero; /healthz de esta devuelve
# 503 mientras el esquema este atrasado, asi el orquestador no le manda trafico antes de tiempo.

FROM node:24-slim AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS construccion
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
# Prisma 7 genera el cliente en src/generated (fuera de git). No se conecta a la base:
# la URL de aqui solo existe para que la configuracion cargue. El build tampoco la usa.
RUN DATABASE_URL=postgresql://construccion:construccion@127.0.0.1:5432/construccion npx prisma generate \
    && DATABASE_URL=postgresql://construccion:construccion@127.0.0.1:5432/construccion \
       SESSION_SECRET=solo-para-construir-la-imagen-no-es-un-secreto npm run build

FROM node:24-slim AS ejecucion
# curl entra solo para la sonda de salud del HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 aplicacion
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=construccion --chown=aplicacion:aplicacion /app/.next/standalone ./
COPY --from=construccion --chown=aplicacion:aplicacion /app/.next/static ./.next/static
COPY --from=construccion --chown=aplicacion:aplicacion /app/public ./public
USER aplicacion
EXPOSE 3000

# Sin trafico no consulta la base (ver src/lib/salud.ts), asi que la sonda no la mantiene despierta.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "server.js"]
