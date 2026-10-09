disposition: fix

> Las capturas, los fotogramas y los videos (28 MB) no estan en git: se archivaron fuera del repositorio, en `Proyectos/archivo-capturas-powerpoint-automated-web/revision-acabado-diseno-2026-10-08/`. Los guiones de `web/e2e/capturas-revision/` las regeneran; la falla de semillas que se menciona abajo ya la resolvio la semilla unificada (`web/e2e/semilla.ts`).

Revisión sobre `b787962` (rama `feat/reescritura-nextjs`; incluye el commit del usuario con `DESIGN.md`, `.impeccable/design.json`, `docs/reescritura-nextjs-verificacion.md` y `web/e2e/tareas/movimiento.spec.ts`). El revisor de acabado corrió como subagente de un solo contexto. El procedimiento dice "sin navegador", pero el encargo pedía capturas propias y pruebas de comportamiento, así que el mismo revisor las tomó: build de producción de Next en el puerto 3401 y Flask en el 5401, sobre la base `newlink_revision`. Entradas que no aplican: no hay comp aprobado, `state.json`, `spec.json` ni `diff/`, porque la construcción partió del código; la tarjeta del mundo se usa solo como referencia de crítica (`referencia/tarjeta.png` y `referencia/tarjeta-hero.png`). Detector: `impeccable detect --json web/src` da 0 hallazgos, salida 0. Es un falso negativo en los antetítulos del reporte (ver material 6).

Evidencias en `.impeccable/review/`:
- 184 capturas a página completa, a 1440 y 390 px, en claro y oscuro.
- `desktop.png` y `mobile.png`: Inicio del analista.
- Movimiento firma: `mov-{normal,reducido}-*.png`, `video/mov-{normal,reducido}.webm` y `movimiento-traza.json` (posición y fondo por fotograma).
- Proceso real: `proceso-real-1440-*.png` y `proceso-real-*.json`.
- Teclado y objetivos táctiles: `sondeo-a11y.json` y `foco-*.png`.
- Guiones: `web/e2e/capturas-revision/capturar.ts` (por fases, con `evaluate` en cadena para evitar `__name` bajo `tsx`) y `sondeo-a11y.ts`.

## persistence

- **PASA:** `PRODUCT.md` existe. El contrato de dirección existe y FORM lleva la clave del sorteo `c9400a17`. Construcción guiada por código: no hay ronda de comps ni `state.json` que exigir.
- **PASA con observaciones: `DESIGN.md` (y `design.json`) frente a lo construido.** Coincide en tokens base, tipografía (Barlow, Barlow Condensed, JetBrains Mono cargadas con `next/font`), filas de 44 px, radios 4/8, FLIP de 220 ms y la Regla del Amarillo. Discrepa en:
  1. La Regla del Amarillo ("no indica estado") la incumple el propio código. `ProcesoSalida` pinta en amarillo la fase activa y su porcentaje (`components/ui/proceso.tsx:39`), y el aviso neutro usa un punto amarillo (`components/ui/avisos.tsx:40`). O se corrige el código (material 1) o el documento miente.
  2. "`data-encendida` ilumina amarillo un cambio visto durante ocho segundos" describe mal el comportamiento real. La celda queda encendida hasta que se ve: 8 s con al menos el 60 % de la celda a la vista, 1,2 s tras pasar el ratón o al recibir el foco. Además lleva un punto que late (`animate-pulse`) y el documento no lo menciona.
  3. No documenta `ProcesoSalida`, el contador que entra como paleta de split-flap ni la paleta propia de los gráficos. Esa paleta vive en `app/(app)/_datos/viz.css` con hexadecimales sueltos (`--serie-1: #2a78d6`…) y es un segundo sistema de color fuera de `globals.css`.
  4. Omite los tonos de estado (`info`, `aviso`, `neutro`, `violeta`), `--texto-3`, `--acero` y todos los valores del tema oscuro. También omite `--dur-vista` (340 ms), que usan la celda y el contador por encima de los 150–250 ms del contrato.
  5. `design.json` dibuja la navegación activa con `border-left: 2px`. Lo construido es una barra interior de 3 px que se escala.
- **FALLA (menor):** el commit `b787962` añade en la raíz `2026-10-08-203220-quiero-probar-cmo-sera-implementar-las-funciona.txt`, una transcripción de 5653 líneas. Hay que sacarla del repo.
- **FALLA (menor, ya documentado por el usuario):** las semillas no conviven. Tras `tareas` → `solicitudes` → `admin` quedan 124 tareas, 0 solicitudes y 0 notificaciones; `solicitudes` deja 2 tareas de las 44 de `tareas`. Por eso las capturas se tomaron resembrando por fase. `CONVENCIONES.md` ya lo advierte; falta la semilla unificada.

## fidelity

No hay comp aprobado. La matriz se hace contra el contrato (OWN-WORLD, FIRST VIEWPORT, FORM) y la tarjeta de la vara.

| Elemento | Veredicto | Evidencia |
|---|---|---|
| Barra lateral de pizarra con logo y navegación activa en amarillo | coincide | `tareas-pase-1440-claro.png` |
| Nombre Newlink en el armazón | **falta** | Solo el monograma de 20–28 px y "DATA INTEL"; "Newlink" no aparece en pantalla dentro de la app (solo en `alt` y `<title>`). En móvil, solo el monograma (`tareas-panel-390-*.png`) |
| Franja de cuatro contadores tabulares que filtran (Vencidas, Hoy, En curso, Bloqueadas) | coincide | `inicio-analista-1440-*.png`, `tareas-panel-*` |
| Panel de salidas en 2/3 con columnas ENTREGA · TAREA · UNIDAD · RESPONSABLE · ESTADO, por entrega | coincide (con defecto de densidad, material 7) | `tareas-pase-1440-claro.png` |
| Pase a la derecha con celdas rotuladas Entrega, Prioridad, Unidad, Responsable | coincide | `tareas-pase-1440-*.png`; hoja inferior en móvil, `tareas-pase-390-*.png` |
| "Nueva tarea" negra arriba a la derecha que pasa a amarilla al confirmar | coincide | `boton.tsx:15` |
| Filas de 44 px, hilos de 1 px, radio de 4 px | coincide | panel y Equipo |
| Sin tarjetas anidadas | **contradice** | Tablero: columna con borde y fondo que contiene tarjetas con borde y sombra (`tareas-tablero-1440-claro.png`). Fichas de cifras con borde dentro de paneles con borde en reporte, análisis y clasificación (`reporte-vista-*`, `analisis-resultado-*`, `clasificacion-resultado-*`) |
| Amarillo solo para identidad y "cambió y no lo has visto" | **contradice** | Fase activa y "62 %" en amarillo (`reporte-nuevo-proceso-a-medias-*`, `proceso-real-1440-1.png`); titular amarillo en `/login`; punto amarillo en el aviso neutro |
| Movimiento firma: la fila se desplaza con FLIP sin desaparecer | coincide, verificado en comportamiento | `movimiento-traza.json`: al mover la entrega 20 días, la fila recorre top 506→635→828→956→1086→1106→1118 en unos 10 fotogramas, con `transform: matrix(…, -612)` en el primero; al cambiar el estado vuelve a viajar (1118→741→…→822). Pero cuando el destino queda bajo el pliegue, la fila sale de la vista sin rastro (material 3) |
| La celda queda encendida hasta que se ve | coincide | 758 fotogramas encendida, entrada y salida con transición de opacidad del amarillo (`fondosDistintos`); `mov-normal-apagada.png` |
| Con reduced-motion solo cambian el color y la opacidad | coincide | Traza reducida: 4 posiciones discretas (null, 1118, 741, 822) sin interpolación; el encendido de color se mantiene |
| Duración del movimiento entre 150 y 250 ms | parcial | FLIP en 220 ms; celda y contador en 340 ms (`--dur-vista`) |
| Procesos largos con fases y progreso real | **contradice** en la ejecución real | `proceso-real-1440.json`: subida 0 % → fase 02 con el mensaje "En cola" y la insignia "EN CURSO" a la vez, barra indeterminada → todas HECHO en un solo sondeo; las fases 03–06 nunca se ven activas. El 62 % de `reporte-nuevo-proceso-a-medias-*` es una respuesta congelada con `route.fulfill` |
| Fases EN COLA → EMBARCANDO → SALIÓ (texto del contrato) | adaptación justificada | El encargo del usuario fija EN COLA → EN CURSO → HECHO. Hay que actualizar el contrato |
| TYPE: Barlow Condensed en mayúsculas para rótulos, Barlow para leer, JetBrains Mono para datos | coincide | Escala de exhibición baja frente a la vara (ver ceiling) |
| MATERIAL: sin imitación de materiales | coincide | CSS plano y honesto; no hay biseles ni papel falso |
| GROUND: panel #E6E8EB y superficie #FFFFFF del contrato | coincide (Δ pequeño) | Fondo #ECEEF1, algo más claro y de la misma temperatura neutra; el oscuro #0D1014 apenas más azul que la tinta #0B0D10. No deriva hacia crema ni hacia pizarra azul |
| Solo español | **contradice** | Admin muestra los códigos `login`, `task_comment` y `task_update` como texto (`admin-1440-*`); el `DndContext` del calendario no tiene `accessibility`, así que dnd-kit anuncia en inglés a los lectores de pantalla (`tareas/_componentes/calendario.tsx:79`) |
| Tema claro y oscuro | coincide | Capturas en los dos temas en todas las pantallas; en las revisadas no se ven roturas |

## ceiling

Recursos propios del mundo "Puerta de embarque" que la construcción no usa. La tarjeta los muestra; nada de esto pide imitar materiales:
- **Escala de exhibición:** la vara vive de un rótulo enorme (el "A12"). Aquí el mayor tipo de pantalla es el H1 de 28 px y los contadores de 40 px. La franja de salidas pide cifras de 56–64 px en mono, que llevarían el primer vistazo.
- **Código del pase:** en la tarjeta, "AA 1023 / SEQ 012" es la cabecera; en el pase de la app, `#127` va a 13 px en gris. Hay que subir el id (y la entrega como "06 OCT · HACE 3 D") a cabecera mono grande, con la línea de corte del pase como un hilo discontinuo real entre cabecera y celdas, que es un separador y no una textura.
- **Pulso del panel en vivo:** la vara pone "09:41 ET ⟳" en la cabecera del panel. El panel sondea cada 60 s, pero no dice "Actualizado 10:42" ni marca el momento del refresco.
- **Bloque escaneable:** la vara lo trae; aquí puede ser un QR real del enlace en `/reportes/[token]`, para compartir en reunión, con función de producto y no de adorno.
- **Gráficos en el idioma del mundo:** líneas `type="monotone"` suavizadas (`_datos/graficos.tsx:155-156`, `equipo/_componentes/graficos.tsx:179-183`) y barras azules de paleta genérica. El panel de salidas pide trazo recto con puntos, rejilla de hilos, rótulos de eje en mono tabular y la serie actual en tinta frente a la previa en acero.
- **El amarillo solo cuando es excepción:** en la vara hay una sola fila encendida ("NOW C12"); su fuerza viene de la escasez.

## material_fixes

**Materiales** (de más a menos grave; cada uno con pantalla, captura, problema, regla y corrección):

1. **El amarillo funciona como estado.**
   - Dónde: /reportes/nuevo y los demás procesos (`reporte-nuevo-proceso-a-medias-1440-claro.png`, `proceso-real-1440-1.png`), /login (`login-1440-claro.png`) y los avisos.
   - Problema: la fase "en curso" y su porcentaje van en amarillo; el titular del login va en amarillo; el punto del aviso neutro es amarillo.
   - Regla: OWN-WORLD ("nunca es un estado"), PRODUCT.md Brand Commitments, `DESIGN.md` (Regla del Amarillo).
   - Corrección:
     - `web/src/components/ui/proceso.tsx:39`: activo → `border-texto bg-texto text-superficie`.
     - `components/ui/avisos.tsx:40`: el tipo neutro → `bg-texto-3`.
     - `app/login/page.tsx`: "TRABAJO EN MARCHA." → `text-rail-fuerte`.
     - El amarillo se queda en el monograma y en la navegación activa.

2. **Muro de amarillo y latido que distrae.**
   - Dónde: Inicio, "Cambió desde tu última visita" (`inicio-analista-1440-*.png`: 7 celdas encendidas a la vez, cada una con un punto `animate-pulse`); campana (`campana-analista-390-claro.png`: 5 notificaciones con fondo amarillo y su icono en amarillo).
   - Regla: queja del usuario ("animación que distrae", "pinta de juguete"); THESIS (encendido = lo que cambió y no has visto; si todo está encendido, nada lo está); `operate.md` (el movimiento comunica estado, no decora).
   - Corrección:
     - `components/ui/estado.tsx:70`: el punto deja de latir (sin `animate-pulse`) o late como mucho dos ciclos.
     - `app/(app)/page.tsx`, `Cambios`: quitar `encendidaInicial` a todas; encender solo los cambios de las últimas 24 h, como máximo tres, y en el resto mostrar la celda con su tono de estado y una marca de 6 px amarilla en la fila.
     - `components/notificaciones/campana.tsx:208-213`: no leída → `bg-superficie-2`, con el punto o el borde de 1 px en `marca`; el icono, en `text-texto`.

3. **El movimiento firma se pierde cuando la fila viaja fuera de la vista.**
   - Dónde: /tareas con el pase abierto (`mov-normal-entrega-0…5.png`, `mov-normal-entrega-final.png`, `movimiento-traza.json`: la fila editada salta de top 506 a 1118 en una ventana de 900 px).
   - Problema: quien cambia la fecha ve desaparecer la fila hacia abajo, y la celda encendida aterriza donde nadie la ve. La prueba `movimiento.spec.ts` no cubre este caso porque su escenario solo tiene dos filas contiguas.
   - Regla: FORM (signature move: "se desplaza a su nueva posición… queda encendida hasta que el usuario la ve"), principio "Nunca a ciegas".
   - Corrección: en `tareas/_componentes/panel-salidas.tsx`, `Fila`, al terminar el FLIP (`onLayoutAnimationComplete`), si la fila es la seleccionada o la recién guardada y queda fuera de la vista, llevarla a la vista con `scrollIntoView({ block: "nearest", behavior: reducido ? "auto" : "smooth" })`. Alternativa: mostrar un chip pegado al borde del panel ("Movida al 29 oct ↓") que lleve hasta ella. Hay que añadir ese caso a `movimiento.spec.ts`, con más de 12 filas entre origen y destino.

4. **El progreso real no se ve en una ejecución real.**
   - Dónde: /reportes/nuevo, y por la misma primitiva clasificación, unión y análisis (`proceso-real-1440.json`, `proceso-real-1440-1.png`).
   - Problema: la fase 02 muestra el mensaje "En cola" junto a la insignia "EN CURSO" con barra indeterminada, y salta a todo HECHO; las fases 03–06 nunca se ven activas.
   - Regla: FORM ("fases… con progreso real"), PRODUCT principio 2, `CONVENCIONES.md` (procesos largos).
   - Corrección:
     - `app/(app)/_datos/proceso.ts`: pasar `enCola` a `ProcesoSalida` y, mientras `t.estado === "en_cola"`, mostrar la fase con la insignia "EN COLA", sin barra y con el mensaje "Esperando turno".
     - Cuando el sondeo vea que la fase avanzó más de una, o recibe `hecho`, encolar las fases saltadas y marcarlas HECHO una a una (100 ms cada una; con reduced-motion, a la vez).
     - Sondear cada 250 ms durante los primeros 3 s.
     - `reportes/nuevo/flujo.tsx:33`: redirigir al acabar esa secuencia, no a los 700 ms fijos.

5. **Compromisos de marca incumplidos: nombre Newlink y "solo español".**
   - Dónde: todo el armazón (`tareas-pase-1440-claro.png`, `tareas-panel-390-claro.png`), Admin (`admin-1440-claro.png`, `admin-actividad-*`), calendario.
   - Problema: "Newlink" no aparece en pantalla dentro de la app; Admin muestra códigos en inglés (`login`, `task_comment`, `task_update`); dnd-kit anuncia en inglés en el calendario.
   - Regla: PRODUCT.md Brand Commitments ("Nombre y logo… obligatorios", "Interfaz solo en español").
   - Corrección:
     - `components/shell/armazon.tsx:147-154`: marca "NEWLINK" en `font-rotulo` con "Data Intelligence" debajo en `text-rail-texto`; en la cabecera móvil, "Newlink" junto al logo.
     - En las consultas de actividad de `lib/admin`, un mapa de `action` a texto ("Inicio de sesión", "Comentario en tarea", "Tarea actualizada"…), usado en el índice y en /admin/actividad.
     - `tareas/_componentes/calendario.tsx:79`: `accessibility={{ announcements, screenReaderInstructions }}` en español, como ya tiene `tablero.tsx:144`.

6. **Elementos que el suelo prohíbe.**
   - Dónde: /reportes/[token] (`reporte-vista-1440-*.png`); /tareas en Tablero; reporte, análisis y clasificación.
   - Problema: antetítulos sobre cada encabezado ("¿CUÁNTO SE HABLÓ?" sobre "ASÍ SE MOVIÓ LA CONVERSACIÓN"; "NEWLINK · ESCUCHA SOCIAL" con una raya amarilla sobre el H1); tarjetas anidadas.
   - Regla: craft-floor Refuse (el antetítulo es una prohibición, no un valor por defecto; tarjetas anidadas "always wrong"); `CONVENCIONES.md` ("nada de antetítulos").
   - Corrección:
     - `app/(app)/reportes/[token]/vista.tsx:69-72`: quitar `<p className="rotulo">{pregunta}</p>` y dejar que el H2 hable solo.
     - Líneas 253-254: quitar la raya y el rótulo; "Newlink · Escucha social" pasa a la línea de metadatos bajo el título.
     - `tareas/_componentes/tablero.tsx:166`: la columna, sin borde ni fondo (solo la cabecera con un hilo inferior), y las tarjetas como filas con hilo y sin sombra.
     - Las fichas de cifras dentro de paneles: celdas de una rejilla con `gap-px bg-hilo`, como la franja de contadores, no cajas con borde propio.

7. **El panel de salidas desperdicia ancho y trunca lo que importa.**
   - Dónde: /tareas con el pase abierto (`tareas-pase-1440-claro.png`).
   - Problema: el título cabe en unos 210 px y se corta mientras "Data Intelligence" y "analista" se repiten idénticos en todas las filas de "Asignadas a mí". La rejilla no tiene hueco, y los puntos suspensivos del título tocan la columna siguiente ("…campa…Data Intelligence"). El cliente se corta a una letra ("E", "A…"). En móvil, la línea de metadatos parte "06 oct · / hace 3 d" en dos y corta "anal…" (`tareas-panel-390-claro.png`).
   - Regla: queja del usuario (densidad mal usada), STORY ("se entiende en un vistazo"), craft-floor Verify (texto real en cada ancho).
   - Corrección en `tareas/_componentes/panel-salidas.tsx`:
     - `COLUMNAS`: añadir `gap-x-3`.
     - Ocultar Responsable cuando el alcance es "mías" y Unidad cuando todas las filas visibles comparten unidad.
     - Con el pase abierto, mover esas dos columnas a `2xl:`.
     - `Meta`: el cliente con `min-w-[6ch]`, y si no cabe, se omite.
     - En móvil, fecha relativa abreviada en una sola línea con `whitespace-nowrap`.

8. **Contraste, bordes y objetivos táctiles por debajo del mínimo.**
   - Dónde: tokens globales (cálculo en la sección de accesibilidad), barra de /tareas en móvil (`sondeo-a11y.json`).
   - Problema:
     - `--texto-3` #6B7178 da 4,24:1 sobre `--fondo` y 3,94:1 sobre `--superficie-hundida` (los metadatos de la fila seleccionada).
     - Los rótulos de grupo del rail (`text-rail-texto/60`, 11 px) dan unos 4,3:1.
     - El borde de los campos (`--hilo-fuerte`) da 1,95:1 en claro y 1,72:1 en oscuro, por debajo del 3:1 de WCAG 1.4.11.
     - En móvil, "Actualizar", las vistas y los segmentos de alcance miden 36 px y los chips del calendario 28 px, por debajo de los 40 px de `CONVENCIONES.md`.
   - Regla: craft-floor Verify (contraste), WCAG AA, `CONVENCIONES.md`.
   - Corrección:
     - `globals.css`: `--texto-3` en claro → #5C6269 (5,3:1 sobre el fondo, 4,9:1 sobre hundida); `--hilo-fuerte` → #878D96 en claro y #5F6873 en oscuro.
     - `armazon.tsx`, rótulos de grupo → `text-rail-texto/80` (6,5:1).
     - `tareas/_componentes/barra.tsx`: `h-9` → `h-10` en los controles de la barra.
     - En móvil, la lista del calendario con filas de al menos 40 px.

**Menores** (no bloquean, en orden):
- **Gráficos:** pasar de `type="monotone"` a `"linear"` con puntos. En Equipo, los ticks del eje Y son 0, 4, 8, 14 (desiguales: usar `allowDecimals={false}` y un dominio redondo) y la semana en curso aparece como una caída a cero (dibujarla discontinua o excluirla). En el histograma de Análisis, redondear los límites de las clases (116.98, 250.93 → 117, 251).
- **Copy:** "4 activa(s)" y "3 unidad(es)" (Admin); "1 filas" y "1 menciones" (Clasificación); en Análisis faltan tildes en el texto del servicio ("numericas", "mas frecuente", "esta faltante"); "Sin Clasificar" en mayúsculas iniciales; "15.8 B" en vez de "15,8 mil M" o "15.8 mil millones".
- **Semántica del panel:** `role="table"` contiene un `ul` y `li role="row"`, y las cabeceras de grupo son `li` sin rol, así que la tabla se rompe para los lectores de pantalla. Poner `role="rowgroup"` en el `ul` y las cabeceras como `role="row"` con una `role="cell"` (`panel-salidas.tsx:80-85`).
- **Franjas laterales de más de 1 px:** la fila seleccionada en Solicitudes lleva una franja negra de 3 px (`solicitudes-lider-1440-*`) y la opción activa de la paleta una amarilla de 3 px (`paleta.tsx:186`). Pasar a fondo `bg-hundida` o a una franja de 1 px.
- **Duraciones:** `--dur-vista` de 340 ms en la celda y el contador, fuera de los 150–250 ms del contrato → 240 ms.
- **Calendario:** el sábado y el domingo ocupan el mismo ancho aunque casi siempre están vacíos (`grid-cols-[repeat(5,1fr)_0.6fr_0.6fr]`), y los títulos de los chips se cortan a unos 12 caracteres.
- **Pase:** el campo de fecha nativo muestra mm/dd/aaaa en un navegador en inglés (`tareas-pase-1440-claro.png`: "10/06/2026" por el 6 de octubre). Mostrar "06 oct" y abrir el selector al pulsar.
- **Inicio:** `MarcarVisita` marca la visita al montar, así que "Cambió desde tu última visita" se vacía con solo abrir la página. Marcarla al salir, o tras 8 s con el panel a la vista.
- **Admin:** las pestañas van encima del H1; en móvil, las pestañas desbordan sin indicarlo. En Personas, "Data Intelligence · Sin unidad" mezcla rol y unidad (`admin-personas-390-*`).
- **Pasos en móvil:** los rótulos se cortan ("COLUMN…" en `union-columnas-390-claro.png`).
- **Login:** el panel izquierdo queda vacío salvo el titular, y el pie en mono ("NEWLINK · DATA INTEL") usa la mono como disfraz.
- **Persistencia:** sacar del repo el `.txt` de la transcripción y actualizar en `DESIGN.md` y el contrato los cinco puntos de la sección persistence.

**Accesibilidad verificada** (para el registro):
- Foco visible en todo lo recorrido con Tab (contorno de 2 px; en el tablero, anillo de 2 px en la tarjeta, `foco-tablero-1440.png`).
- La paleta se maneja con flechas, Inicio/Fin y Enter (`sondeo-a11y.json`, "paleta activo").
- El tablero tiene `KeyboardSensor` con anuncios en español; el calendario mueve con Alt+flechas.
- Todos los controles medidos tienen nombre accesible (0 sin nombre en 6 pantallas).
- No se midió el desbordamiento horizontal a 390 px; en las capturas, solo el tablero desplaza en horizontal, dentro de su carril.

## keep

No hay que diluir el FLIP de la fila, que se desplaza sin desaparecer y salta sin recorrido con reduced-motion (verificado fotograma a fotograma). Tampoco la gramática de la fila de 44 px con celda de estado en tono y rótulo condensado, ni el vocabulario EN COLA / EN CURSO / HECHO que ya comparten procesos y solicitudes: los arreglos deben añadir escasez al amarillo, no quitar movimiento ni densidad.
