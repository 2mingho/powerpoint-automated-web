# Convenciones de la app Next.js (reescritura)

Lee esto entero antes de escribir código. Es el contrato entre todos los que trabajan en `web/`.

## Qué es

Reescritura en JavaScript (Next.js 16.4 + Prisma 7 + PostgreSQL) de la app Flask de la raíz del repo. Flask sigue siendo **la referencia funcional**: cada pantalla y cada regla se porta desde `../blueprints/`, `../services/`, `../templates/` y `../static/js/`. Las pruebas de `../tests/` dicen qué contratos no pueden romperse. El análisis de datos (reportes, clasificación, unión de archivos y análisis de CSV) **sigue en Python** y se llama como servicio interno.

Producto y diseño: `../PRODUCT.md` (quién lo usa y qué no se puede romper) y `../.impeccable/surfaces/web-src-app-app-page-tsx.md` (contrato visual "Puerta de embarque"). Calidad mínima de interfaz: `../.claude/skills/impeccable/reference/craft-floor.md` y `operate.md`.

## Next.js 16.4: no es el que conoces

- Lee `node_modules/next/dist/docs/` antes de usar una API. `middleware` ahora es `src/proxy.ts`.
- **Cache Components está activo.** Todo acceso a `cookies()`, `headers()`, `searchParams`, `params` o a la sesión debe estar dentro de un `<Suspense>` (o en un `loading.tsx`). El patrón: la página es un componente síncrono que pinta el marco y el título, y mete los componentes async con datos en `<Suspense fallback={<Esqueleto…/>}>`. Si el log de `next dev` dice "encountered runtime data during prerendering", está mal.
- Tipos de ruta: `PageProps<"/ruta">`, `LayoutProps<"/ruta">`, `RouteContext<"/api/…">`. Tras crear rutas, ejecuta `npm run typecheck` (regenera tipos y pasa `tsc`).
- Las mutaciones desde formularios usan Server Actions (`"use server"`) o rutas en `src/app/api/**/route.ts` con `conUsuario()` de `@/lib/api`. Las listas que cambian mucho en el cliente (tablero, bandeja) usan rutas de API JSON.

## Datos

- Cliente: `import { db } from "@/lib/db"`. Modelos con el nombre de la tabla (`db.tasks`, `db.users`…). Relaciones renombradas en `prisma/schema.prisma` (p. ej. `tasks.asignado`, `tasks.creador`, `tasks.padre`, `users.manager`). **No cambies el esquema de la base**: Alembic (Flask) sigue siendo su dueño mientras convivan. Si necesitas una columna nueva, pídela en tu informe final.
- `due_date` y demás columnas `@db.Date` son días de negocio: usa `isoDeFecha` / `fechaDeIso` de `@/lib/reloj`. "Hoy" es `hoyNegocio()` (America/Santo_Domingo), nunca `new Date()` del navegador.
- Las columnas de fecha y hora se guardan en UTC sin zona; muéstralas convertidas a `ZONA_NEGOCIO`.
- Evita N+1: carga relaciones con `include`/`select` y agrupa los conteos (`groupBy`), como hacía Flask.

## Permisos: lo más sensible

- Sesión: `usuarioActual()` / `exigirUsuario()` de `@/lib/auth/session`. Herramientas: `tieneHerramienta(u, "tasks")`.
- Alcance por unidades: `@/lib/alcance` (`alcanceUnidades`, `ambitoUnidades`, `puedeVerEquipo`, `papel`). Las tareas, **siempre** con `@/lib/tareas/alcance` (`filtroTareasVisibles`, `puedeVerTarea`, `puedeEditarTarea`, `puedeAsignarA`). Nunca resuelvas la visibilidad por tu cuenta.
- Cierra en falso: un alcance vacío produce cero filas. Lo que alguien no puede ver no aparece, ni siquiera como conteo, salvo el "y N que no puedes ver" que ya existía.
- Cada ruta de API usa `conUsuario(handler, { herramienta, soloAdmin })`. Los errores salen como `{ error: "mensaje en español" }` con el código HTTP correcto (400, 403, 404, 409).
- Registro de actividad: `registrarActividad()` de `@/lib/actividad`, con los mismos `action` que Flask (`task_update`, `task_delete`…). Notificaciones: `notificar` / `notificarVarios` de `@/lib/notificaciones`. Nunca se avisa a quien hizo el cambio.

## Diseño: mundo "Puerta de embarque"

- Solo tokens de `src/app/globals.css` (clases `bg-superficie`, `text-texto-2`, `border-hilo`, `text-alerta`…). **Ningún color suelto.** Funciona en tema claro y en oscuro (`data-theme`), compruébalo en los dos.
- Tipografía: `font-sans` (Barlow) para leer; `font-rotulo` (Barlow Condensed, mayúsculas, con tracking) para rótulos de columna, títulos de panel y botones; `font-mono` con `cifras` **solo para datos** (horas, fechas, ids, contadores, porcentajes). La clase `.rotulo` es el rótulo de columna estándar.
- El amarillo (`bg-marca`) es identidad (logo, navegación activa) y la marca de "cambió y no lo has visto". **Nunca es un estado de tarea.** Los estados usan los tonos del catálogo (`neutro`, `info`, `aviso`, `alerta`, `bien`, `violeta`).
- Primitivas en `src/components/ui/`: `Boton`, `Campo`/`Entrada`/`Selector`/`AreaTexto`, `CeldaEstado` (el movimiento firma: se enciende al cambiar y se apaga cuando se ve), `Contador`, `Panel`, `Vacio`, `Esqueleto`, `Dialogo`, `useAvisos` (con "Deshacer"), `ProcesoSalida` (procesos largos por fases con progreso real). Úsalas. Si necesitas una nueva y genérica, créala en `src/components/ui/` y menciónala en tu informe.
- Densidad: filas de 44px separadas por hilos de 1px, nada de tarjetas grandes con aire de sobra. Nada de tarjetas anidadas, de antetítulos sobre los encabezados, de texto con degradado, de bordes laterales de color de más de 1px ni de emojis como iconos (los iconos salen de `lucide-react`).
- Movimiento: solo para explicar estado, feedback o continuidad. Entre 120 y 250 ms con `ease-salida` (`var(--curva)`). Para reordenar listas, `motion/react` con `layout` (FLIP): **la fila se desplaza, no desaparece**. Todo con `motion-safe:` o respetando `prefers-reduced-motion`. Nada de coreografías al cargar la página.
- Procesos largos: siempre `ProcesoSalida` con fases y progreso real. Nunca una pantalla quieta sin decir qué pasa.
- Estados obligatorios en cada pantalla: cargando (esqueleto, no un spinner en medio), vacío (que enseñe qué hacer), error (qué pasó y cómo seguir), sin permisos.
- Formularios cortos: lo esencial arriba y lo ocasional plegado (`<details>`). Valida en el cliente y vuelve a validar en el servidor.
- Móvil: barra inferior (ya existe). Objetivos táctiles de al menos 40px. Las tablas pasan a filas apiladas, nunca con scroll horizontal de la página.
- Textos solo en español, con el vocabulario del producto (tarea, unidad, solicitud, observar…). Los botones dicen su acción ("Crear tarea", no "Enviar").

## Estructura

```
src/app/(app)/<modulo>/page.tsx            pantallas autenticadas (dentro del armazón)
src/app/(app)/<modulo>/_componentes/*.tsx  componentes del módulo
src/app/api/<modulo>/**/route.ts           API JSON
src/lib/<modulo>/*.ts                      lógica de servidor del módulo
e2e/<modulo>/*.spec.ts                     pruebas Playwright (API y UI)
src/**/*.test.ts                           pruebas unitarias Vitest de la lógica pura
```

**Archivos compartidos.** No los edites salvo que tu encargo lo diga: `src/lib/{db,alcance,catalogo,actividad,api,reloj,notificaciones,limite}.ts`, `src/lib/auth/*`, `src/lib/tareas/alcance.ts`, `src/components/ui/*` (puedes **añadir** archivos nuevos), `src/components/shell/*`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/globals.css`, `prisma/schema.prisma`, `package.json`. Si necesitas un cambio en uno de ellos, descríbelo en tu informe final, con el diff propuesto.

## Entorno de cada agente

- Base de datos propia: `DATABASE_URL=postgresql://newlink:newlink_dev@127.0.0.1:55432/newlink_<modulo>` (pásala por la línea de comandos; no edites `.env`).
- Servidor propio: `DATABASE_URL=… npx next dev -p <puerto>`, con el puerto que te toque. Detenlo al terminar.
- Usuarios de prueba en todas las bases (contraseña `demo1234`): `demo@local.test` (admin) y `analista@local.test` (rol DI, unidad "Data Intelligence"). Crea tus propios datos de prueba en tu base.
- Antes de terminar: `npm run typecheck` sin errores, `npx eslint <tus archivos>` limpio, tus pruebas e2e en verde, y revisa tus pantallas en escritorio (1440px) y móvil (390px), en tema claro y oscuro.

## Batería integrada

Usa una base PostgreSQL **descartable y explícita** con `DATABASE_URL` en la línea de comandos: la semilla vacía y vuelve a sembrar esa base, y `web/.env` apunta a la de desarrollo. Todas las baterías corren juntas contra un solo servidor (`BASE_URL`, por defecto 3301) y una sola base, sembrada una vez por `e2e/preparar.ts` (`globalSetup`) con `e2e/semilla.ts`: `npx playwright test`. El proyecto fija `workers: 1` porque los casos comparten base y sesiones. Para repetir sin resembrar, `SIN_SEMILLA=1`. El servicio Python de análisis debe apuntar a la misma base para `e2e/datos`.

`ANALYTICS_URL` es la **raíz** de Flask (por ejemplo `http://127.0.0.1:5101`); el cliente añade `/api/interno` por sí mismo. Poner ese prefijo en la variable devuelve 404 en subidas y previsualizaciones.
