# Newlink · aplicación web (Next.js)

Next.js 16 (Cache Components) + Prisma 7 + PostgreSQL. La interfaz y la API de tareas, solicitudes, estudios, ingresos y administración viven aquí; el **análisis de datos sigue en Flask** (`../blueprints/interno.py`) y se llama como servicio interno.

- Convenciones y reglas de permisos: [`CONVENCIONES.md`](CONVENCIONES.md) (léelo antes de escribir código).
- Despliegue, variables y corte de Flask: [`../docs/despliegue.md`](../docs/despliegue.md).

## Desarrollo

```bash
cp .env.example .env        # DATABASE_URL, SESSION_SECRET, ANALYTICS_URL, ANALYTICS_TOKEN
npm ci && npm run db:generate
npm run dev
```

El esquema **no** se crea desde aquí: lo aplica Alembic (`flask db upgrade`, desde la raíz). Prisma solo lo lee; si cambias una tabla, la migración va en `../migrations` y `prisma/schema.prisma` se actualiza a mano para coincidir (el CI compara las dos).

## Pruebas

```bash
npm run typecheck && npm run lint && npm test      # unitarias (Vitest)
DATABASE_URL=postgresql://…/newlink_algo npx playwright test   # e2e
```

Las pruebas e2e **vacían y siembran** la base de `DATABASE_URL`: usa siempre una descartable llamada `newlink_<algo>` (la semilla se niega en otra). Detalles en `CONVENCIONES.md`.
