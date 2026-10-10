---
version: 1
slug: "web-src-app-app-page-tsx"
primary_target: "web/src/app/(app)/page.tsx"
related_targets: ["web/src/app/(app)/tareas/page.tsx"]
---

# Inicio + Mis tareas (primera superficie del rediseño)

Modo: Operate. Público: analistas en escritorio toda la jornada; líderes y directores desde el móvil; otras unidades que siguen sus solicitudes. Tarea: saber qué toca hoy, qué cambió y qué está bloqueado, y actuar sin abrir formularios. Restricciones del usuario: nada de pinta de juguete, nada de densidad baja, nada de animación que distraiga. El resto de pantallas hereda este mundo.

## Direction contract

THESIS: Mis tareas es un panel de salidas: el trabajo se ordena por hora de entrega y cada cambio de estado se reordena en su sitio y queda encendido hasta que lo ves. Rechaza la lista de tarjetas sueltas del gestor genérico.

OWN-WORLD: Tinta #0B0D10, pizarra #1C2127, acero #6B7178, panel #E6E8EB, superficie #FFFFFF. El amarillo Newlink #FADF25 es identidad (logo, navegación activa) y la marca de "cambió y no lo has visto"; nunca es un estado de tarea. Estados: rojo vencida, ámbar en riesgo, verde hecha, acero en espera. Barlow Condensed en mayúsculas con tracking para rótulos de columna y titulares de panel; Barlow para el cuerpo; JetBrains Mono tabular solo para datos (horas, fechas, ids, contadores). Filas de 44px separadas por hilos de 1px, sin tarjetas anidadas, radio de 4px. El detalle de la tarea es un pase segmentado con celdas rotuladas: Entrega, Prioridad, Unidad, Responsable.

STORY: Al entrar se entiende en un vistazo cuánto vence hoy, qué está en curso y qué se movió desde la última visita. Se completa, se mueve o se comenta desde la fila. Quien lidera ve la carga de su unidad con la misma gramática.

FIRST VIEWPORT: Barra lateral de pizarra a la izquierda, con el logo y la navegación (el elemento activo en amarillo). Arriba, una franja de salidas con cuatro contadores tabulares grandes: Vencidas, Hoy, En curso, Bloqueadas; cada uno filtra al pulsarlo. Debajo, a la izquierda, el panel de salidas, que ocupa unas 2/3 del ancho: columnas HORA/ENTREGA · TAREA · UNIDAD · RESPONSABLE · ESTADO, con las filas ordenadas por entrega. A la derecha, el pase de la tarea seleccionada. La acción principal, "Nueva tarea", va arriba a la derecha y es negra; al confirmarse se vuelve amarilla.

FORM: Puerta de embarque (tarjeta de embarque + panel de salidas), alternativa competitiva elegida por el usuario frente a la asignada (posición 3 de la lista propia, tablero split-flap). Clave del sorteo: c9400a17. Signature move: cuando una tarea cambia de estado o de fecha, su fila se desplaza a su nueva posición con FLIP (sin desaparecer) y la celda de estado queda encendida en amarillo hasta que el usuario la ve o pasan 8 s con la fila a la vista. Los procesos largos (generar reporte, clasificar, subir) muestran un panel de salida con fases que van pasando de "EN COLA" a "EMBARCANDO" y "SALIÓ", con progreso real. Movimiento entre 150 y 250 ms, ease-out exponencial; con reduced-motion solo cambian el color y la opacidad.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
