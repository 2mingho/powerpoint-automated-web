# Verificación de la reescritura Next.js · 2026-10-08

## Veredicto

Los cuatro módulos integrados funcionan contra un único servidor Next.js de producción y un servicio Flask de análisis, con PostgreSQL **aislado** (`newlink_continuidad_20261008`). No se cambió la base original. Las reglas confirmadas siguen vigentes: tarea invisible → 404; colega con enlace y herramienta de reportes → lectura, sin edición.

## Evidencia

- `npm run build`, `npm run typecheck`, `npm run lint`: correctos. Build advierte que la lectura dinámica de `powerpoints/` en `web/src/lib/admin/consultas.ts` amplía el trazado del bundle; no impide compilar.
- Vitest: 51/51. Pytest: 313/313 (avisos de deprecación preexistentes).
- Playwright sobre el mismo par de servidores, `--workers=1`: Admin 15/15, Datos 12/12, Solicitudes 31/31, Tareas 20/20. Omisiones corresponden a capturas optativas, pruebas de API duplicadas en móvil y pruebas limitadas a escritorio. Antes de Admin se resembró la base; Solicitudes vuelve a sembrar la suya.
- Permisos: 42 rutas y métodos de Admin dan 403 a no administradores. Sus siete páginas ahora devuelven **HTTP 403** (antes HTML «Sin permisos» con HTTP 200). Cierre forzado, acceso admin y ausencia de claves de IA verificados. Aislamiento de tareas, solicitudes, Equipo y reportes cubierto por pruebas e2e.
- Movimiento: prueba `web/e2e/tareas/movimiento.spec.ts` muestrea fotogramas; la fila recorre posiciones intermedias en modo normal y salta sin recorrido en `prefers-reduced-motion: reduce`. En ambos conserva texto y aviso visible.
- Revisión visual: capturas versionadas en `web/e2e/capturas/{tareas,solicitudes,admin,datos}/` cubren 1440/390 px y claro/oscuro. Revisión de muestras de tablero, solicitudes, Admin, Equipo, progreso de reporte y análisis CSV: jerarquía, densidad y tonos coherentes con «Puerta de embarque». Algunas capturas antiguas incluyen indicador de compilación del servidor de desarrollo; no son goldens automáticos. El servidor de verificación fue build de producción.

## Barreras y seguimiento

- Playwright completo **sí es válido en una sola invocación** desde que la semilla unificada (`web/e2e/semilla.ts`) y el `globalSetup` (`web/e2e/preparar.ts`) reemplazaron las semillas por módulo (2026-10-09: 114 pasadas, 0 fallos, con el servicio Python de análisis). La semilla vacía y vuelve a sembrar la base de `DATABASE_URL`: **`web/.env` apunta a `newlink`, así que pasa siempre una base descartable por la línea de comandos**. No se debe usar ninguna semilla en producción.
- `ANALYTICS_URL` necesita raíz de Flask, sin `/api/interno`; el cliente agrega el prefijo. Configurar el mismo `ANALYTICS_TOKEN` en ambos servicios.
- El guion de capturas `web/e2e/capturas-revision/capturar.ts` quedó integrado, pero las capturas y vídeos de la revisión de acabado (28 MB) no están en git: se archivaron en `Proyectos/archivo-capturas-powerpoint-automated-web/`. Los worktrees de `.claude/worktrees/` ya se pueden retirar.
