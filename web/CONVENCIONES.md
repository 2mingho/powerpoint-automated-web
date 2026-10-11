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

## Recurrencia

- Una serie nace con **una sola tarea**; la siguiente se crea **al cerrar** la anterior (`lib/tareas/recurrencia.ts`, llamado desde todos los caminos de cierre: formulario, tablero, edición masiva y lote de administración). Nunca se precalcula.
- La fecha sale de la **entrega** de la que se cierra, no del día del cierre (`siguienteEntrega`): semanal = mismo día de la semana que la primera, la semana siguiente; mensual = mismo día del mes de la primera (si no existe, el último del mes corto y luego vuelve); diaria = siguiente día laborable.
- Todas cuelgan de la primera (`parent_task_id`). No se crea si pasaría de la fecha de fin de la serie (`end_date` de la primera) ni si la serie ya tiene una tarea de esa fecha en adelante (series precalculadas antiguas; lo borrado no resucita). «Dejar de repetir» pone `is_recurrent = false` en la abierta.
- Flask no crea la siguiente al cerrar: mientras convivan, cerrar desde Flask una serie creada aquí la deja sin continuación.

## Estudios

- Un estudio es una tarea con `task_type = 'estudio'` (el contenedor); sus pasos son tareas **normales** hijas (`parent_task_id`) con `phase`. Solo existen en unidades con `areas.has_studies` (Admin → Organización).
- **El contenedor no es una tarea para nadie:** `filtroTareasVisibles` lo excluye (si no, duplicaría carga, entregas y cifras) y `tareaVisible` lo responde 404. Los estudios se leen con `filtroEstudiosVisibles` y `lib/estudios/servicio.ts`; mismo ámbito que las tareas.
- El plan de una unidad son sus plantillas con `fase` (payload: `fase`, `horas`, `metodo`); sin ellas, `PLAN_BASE` de `lib/estudios/plan.ts`. Las fechas de los pasos las reparte `repartirFechas` (días hábiles, en secuencia, proporcional a las horas).

## Ingresos (contratos y metas)

- Todo en USD. El monto de un contrato es el **total** y se prorratea por meses naturales (`lib/seguimiento/finanzas.ts`).
- **Ver** una unidad = supervisarla (`alcanceUnidades`) o poder editarla. **Editar** = concesión de un administrador por persona, unidad y tipo (`finance_grants`, `kind` = `contracts` o `goals`, permisos independientes). El administrador edita todo. Todo en `lib/finanzas/permisos.ts`; nunca resuelvas esto por tu cuenta.
- Las escrituras llaman a `exigirEditarFinanzas`: **404** si no ves la unidad (misma respuesta que si no existiera), **403** si la ves y no la editas. Mover un contrato de unidad exige poder editar las dos.
- La meta de la dirección (`goals.area_id` NULL) la fija solo el administrador y la ve quien ve todas las unidades.
- Un cliente o unidad con contratos no se borra; unir clientes mueve sus contratos.

## Gastos y horas extras de la unidad

Los gestiona quien **lidera** la unidad (`unit_leads`); la dirección que la supervisa (`alcanceUnidades`) los ve sin editar; el
resto de la gente no sabe que existen (404). La administración edita todo. Migración `0019_gastos_horas_extras`.

- **Gastos** (`/gastos`, `lib/gastos/`): USD, como los contratos. Cada gasto lleva fecha, categoría, descripción, monto, proveedor y
  nota. La categoría es texto que se normaliza contra las ya usadas (sin distinguir mayúsculas ni tildes) para que «viajes» y
  «Viajes» no partan un presupuesto. El presupuesto es anual por unidad y categoría; avisa desde el 90 % y marca el exceso, sin
  bloquear. Una unidad con gastos no se puede eliminar. Exporta CSV.
- **Horas extras** (`/horas-extras`, `lib/horas-extras/`): solo las unidades con `areas.has_overtime` (lo activa un administrador en
  Organización, con su máximo por persona y trimestre, 80 por defecto). Nace del Excel de Media Watch: se reporta por **quincena**
  (15 = del 1 al 15, 30 = del 16 al fin de mes), cada hora se segmenta en L-V o SAB-DOM por la fecha trabajada y hay un máximo por
  persona y **trimestre natural**. El reporte (año, mes, quincena) es el de la fecha trabajada o uno posterior (se reporta tarde,
  nunca por adelantado). El máximo avisa y se ve en el mapa de calor; no bloquea. El Excel que se descarga (`exceljs`) repite el
  formato actual: hoja GENERALES y la hoja de la quincena, con fórmulas en los totales (`excel.test.ts` lo comprueba con las cifras
  reales del reporte de septiembre: 73,5 h de 5 colaboradores).

## Volumen: qué se trae de la base

Probado con 60.000 tareas (34.000 abiertas). Reglas para no volver a pedir de más:

- **Nunca una fila por tarea para contar.** Se cuenta en la base (`groupBy`, `count` o SQL agregado). Un `IN (...)` con ids de
  tareas no puede pasar de ~32.000 parámetros (P2029): se filtra por relación (`tasks: { is: where }`), no por lista de ids.
  `distinct` de Prisma se resuelve en memoria: usar `groupBy`.
- **Mis tareas es una ventana alrededor de hoy** (`listarVentana`): las 50 más cercanas hacia atrás y las 50 hacia adelante,
  con «Ver más» por lado (hasta 500). Quien pide más sube `antes` o `despues` y repite la consulta, así el refresco de 60 s
  conserva lo desplegado. `GET /api/tareas` sin `antes`/`despues` sigue devolviendo hasta 500 por entrega.
- **El Panel de Inicio manda celdas, no tareas** (`lib/panel/celdas.ts`): combinaciones de unidad, cliente, persona, tipo,
  contrato, semana, estado, riesgo y puntualidad con su cuenta y sus horas, agrupadas por la base y codificadas con
  diccionarios. Los filtros cruzados siguen siendo instantáneos en el navegador. Lo que necesita la fila real (las abiertas que
  vencen en 4 días, para el riesgo; las cerradas en 30 días, para la puntualidad) entra una a una. El detalle se pide a
  `/api/panel/detalle` con los mismos filtros aplicados en la base; `e2e/tareas/panel.spec.ts` los compara con lo sembrado.
- **Equipo** agrega con SQL (`visibilidadSql`, la misma regla que `filtroTareasVisibles`: si cambia una, cambia la otra) y el
  mapa de calor suma las vencidas en la base y reparte solo las abiertas que pueden tocar sus 4 semanas.
- **Memoria por petición**: `lib/memo.ts` (`porObjeto` por el objeto del usuario; `conCaducidad` para catálogos, que se
  invalidan al editarse). El alcance de unidades se resuelve en una consulta recursiva.
- `hoyNegocio(fecha)` reutiliza un solo `Intl.DateTimeFormat`: construirlo por llamada costaba ~0,7 s por cada 13.000 tareas.

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

Usa una base PostgreSQL **descartable y explícita** con `DATABASE_URL` en la línea de comandos: la semilla vacía y vuelve a sembrar esa base, y `web/.env` apunta a la de desarrollo. Todas las baterías corren juntas contra un solo servidor (`BASE_URL`, por defecto 3301) y una sola base, sembrada una vez por `e2e/preparar.ts` (`globalSetup`) con `e2e/semilla.ts`: `npx playwright test`. El proyecto fija `workers: 1` porque los casos comparten base y sesiones. Para repetir sin resembrar, `SIN_SEMILLA=1`. La semilla y el helper `sql()` de las pruebas se **niegan** a escribir si la base no se llama `newlink_<algo>` (Playwright carga `web/.env`, que apunta a `newlink`, así que olvidar `DATABASE_URL` en la línea de comandos la vaciaría); `SEMILLA_EN_CUALQUIER_BASE=1` levanta la guarda a propósito. El servicio Python de análisis debe apuntar a la misma base para `e2e/datos`.

`ANALYTICS_URL` es la **raíz** de Flask (por ejemplo `http://127.0.0.1:5101`); el cliente añade `/api/interno` por sí mismo. Poner ese prefijo en la variable devuelve 404 en subidas y previsualizaciones.
