# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

En reescritura (rama `feat/reescritura-nextjs`): Next.js (App Router, TypeScript) + Prisma sobre el PostgreSQL existente, decidido por el usuario. Todo pasa a JavaScript salvo el análisis de datos (generación de reportes, clasificación, unión de archivos y análisis de CSV), que queda como servicio Python (pandas, matplotlib, wordcloud) al que llama la app. La app Flask actual sigue siendo la referencia funcional hasta completar la migración.

## Users

Herramienta interna de Newlink (unidad Data Intelligence). Cuatro públicos, todos confirmados:

- **Analistas de medios / social listening**: en escritorio durante toda la jornada. Generan reportes a partir de exportaciones de herramientas de monitoreo, clasifican menciones y gestionan sus tareas del día.
- **Líderes, managers y directores**: supervisan la carga y el avance de sus unidades (jerarquía de mando: un director llega a las unidades a través de sus managers), resuelven solicitudes y revisan indicadores; con frecuencia desde el móvil.
- **Otras unidades de Newlink**: entran sobre todo para solicitar trabajo a Data Intelligence (Solicitudes entre unidades) y seguir su estado.
- **Administradores**: gestionan usuarios, roles, unidades, organización, catálogos de estados y prioridades, plantillas y proveedores de IA.

## Product Purpose

Concentrar en un solo sitio el trabajo de inteligencia de datos: convertir exportaciones de social listening en reportes, clasificar y preparar datos, y coordinar quién hace qué y para cuándo entre unidades. Éxito: cada persona entiende de un vistazo qué le toca y en qué estado está su trabajo, y los procesos largos nunca la dejan a ciegas.

## Positioning

No es un gestor de tareas genérico ni una herramienta de BI genérica: une las herramientas de procesamiento de social listening con la coordinación de trabajo entre unidades, respetando la jerarquía y el alcance por unidad de Newlink.

## Operating Context

- Entrada de datos: CSV o Excel exportados de herramientas de monitoreo (p. ej. Meltwater), con codificaciones y separadores variables.
- Reportes renderizados en la web, persistentes con URL propia, exportables a PDF desde el navegador; plantillas PPTX que suben los administradores.
- Análisis asistido por IA (proveedores configurables, consumo registrado).
- Tareas: bandeja de trabajo diaria, tablero Kanban por estado, calendario, observadores, checklist, comentarios con menciones, etiquetas, dependencias, plantillas, recurrencia, importación y exportación CSV.
- Solicitudes entre unidades: pedir, aceptar (crea tarea) o rechazar con motivo.
- Notificaciones in-app; tour de bienvenida.
- Zona horaria de negocio: Santo Domingo.

## Capabilities and Constraints

- Visibilidad por unidad y jerarquía de mando: nadie ve ni edita trabajo fuera de su ámbito; las reglas de alcance son la parte más sensible y no pueden relajarse en la reescritura.
- Estados y prioridades son catálogos editables; "final" es una bandera, no un nombre.
- Contraseñas existentes en formato werkzeug (scrypt/pbkdf2): la reescritura debe aceptarlas sin forzar restablecimiento.
- Problemas que la reescritura tiene que resolver sí o sí (confirmados): **pantallas confusas** (demasiados campos, navegación poco clara, cosas difíciles de encontrar) y **procesos lentos o sin feedback** (generar reportes, clasificar o subir archivos tarda y no se ve el progreso).

## Brand Commitments

- Nombre y logo de Newlink (`static/img/Newlink_logo.png`), obligatorios.
- Amarillo Newlink `#fadf25` obligatorio y reservado a identidad (logo, elemento activo de navegación); el estado nunca lo usa.
- Interfaz solo en español.
- Tema claro y tema oscuro, ambos obligatorios.

## Evidence on Hand

- Plantillas de reporte en `powerpoints/` (Reporte_plantilla*.pptx).
- No hay testimonios, métricas de uso ni casos publicados: no inventarlos.

## Product Principles

1. Lo de hoy primero: cada pantalla abre en lo que la persona tiene que hacer o decidir ahora, y el resto se descubre al pedirlo.
2. Nunca a ciegas: todo proceso que tarda muestra progreso real y su resultado; todo cambio de estado se percibe.
3. El alcance es sagrado: lo que alguien no puede ver no aparece, ni siquiera como conteo engañoso.
4. Menos campos, mejores decisiones por defecto: lo esencial arriba, lo ocasional plegado.
5. Una sola forma de hacer cada cosa en toda la app.

## Accessibility & Inclusion

- Uso en escritorio y móvil (líderes desde el teléfono): objetivos táctiles cómodos y navegación inferior en móvil.
- Respetar `prefers-reduced-motion` en todo el movimiento.
- El color nunca es el único portador de significado (ya es norma del sistema actual).
