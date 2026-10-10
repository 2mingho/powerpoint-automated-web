---
name: Newlink Data Intel
description: Puerta de embarque para trabajo y datos entre unidades
colors:
  marca: "#fadf25"
  tinta: "#0b0d10"
  pizarra: "#1c2127"
  fondo: "#eceef1"
  superficie: "#ffffff"
  hilo: "#d6d9de"
  texto-secundario: "#474d55"
  alerta: "#c0341d"
  bien: "#1f7546"
typography:
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.35rem"
  label:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.12em"
  data:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.75rem"
rounded:
  sm: "4px"
  md: "8px"
spacing:
  row: "44px"
  control: "40px"
components:
  button-primary:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.sm}"
    height: "{spacing.control}"
  panel:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.md}"
  status-changed:
    backgroundColor: "{colors.marca}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.sm}"
---

# Design System: Newlink Data Intel

## Overview

**Creative North Star: "Puerta de embarque"**

Interfaz operativa de alta densidad: paneles de salidas, filas ordenadas por entrega y detalle como pase segmentado. Trabajo urgente visible al entrar; información ocasional se descubre al pedirla. Precisión de oficina, sin aspecto de juguete ni movimiento que distraiga.

**Key Characteristics:**
- Filas compactas y divisores finos para escanear trabajo real.
- Amarillo Newlink reservado para identidad y cambios todavía no vistos.
- El estado se explica con texto, tono y movimiento breve; procesos largos muestran fases y progreso real.

## Colors

Tinta, pizarra, acero y paneles claros; en oscuro cambian superficies y tonos mediante `data-theme`. Fuente normativa: `web/src/app/globals.css`.

### Primary
- **Amarillo Newlink** (`--marca`, `#fadf25`): logo, navegación activa y celda que cambió; no indica prioridad ni estado final.

### Neutral
- **Tinta** (`--tinta`, `#0b0d10`): acciones primarias y texto claro.
- **Pizarra** (`--pizarra`, `#1c2127`): barra lateral.
- **Panel** (`--superficie`, `#ffffff` claro; `#151a20` oscuro): superficies de trabajo.
- **Hilo** (`--hilo`, `#d6d9de` claro; `#272e37` oscuro): divisores de 1 px.

### Named Rules
**The Yellow Attention Rule.** Amarillo identifica Newlink o un cambio no visto; los estados se expresan con los tonos semánticos del catálogo (`neutro`, `info`, `aviso`, `alerta`, `bien`, `violeta`).

## Typography

Barlow sirve para lectura; Barlow Condensed, en mayúsculas y con tracking, para títulos y rótulos; JetBrains Mono tabular solo para fechas, IDs, contadores y cifras. Escala fija del producto en `globals.css`: cuerpo 14/21.6 px, título principal 28/32 px, rótulos 12/16 px.

## Layout

Barra lateral de pizarra en escritorio; navegación inferior en móvil. Contenido de hasta 1280 px en pantallas de equipo. Filas de 44 px, controles principales de 40 px; tablas se reorganizan en móvil, sin scroll horizontal de página. Listas y paneles separados por hilos; nunca tarjetas anidadas.

## Elevation & Depth

Capas tonales y bordes por defecto. `--sombra-1` (0 1px 2px rgb(11 13 16 / 0.06), 0 1px 1px rgb(11 13 16 / 0.04)) separa paneles; `--sombra-2` y `--sombra-3` se reservan para capas flotantes. Tema oscuro tiene sombras propias en `globals.css`.

## Shapes

Radio 4 px en controles y celdas, 8 px en paneles; bordes finos. Evitar halos y ornamento que compita con datos.

## Components

### Buttons
- `Boton`: primario tinta con texto de superficie; hover pizarra, confirmado amarillo, foco visible. Secundario con borde tinta, fantasma sin fondo y peligro en alerta. Tamaños 32 y 40 px.

### Inputs / Fields
- `Campo`, `Entrada`, `Selector`, `AreaTexto`: etiqueta enlazada, fondo de superficie, borde fuerte; foco tinta con anillo tenue. Error alerta y estado deshabilitado legible.

### Cards / Containers
- `Panel`: superficie, hilo, sombra leve, encabezado compacto. `Vacio` indica siguiente acción, `Esqueleto` conserva estructura durante carga.

### Navigation
- Elemento activo en amarillo sobre rail oscuro; en móvil barra inferior con accesos de trabajo frecuente.

### CeldaEstado
- Texto y tono del catálogo; `data-encendida` ilumina amarillo un cambio visto durante ocho segundos. Reordenación FLIP de fila en 220 ms; con movimiento reducido el cambio es inmediato y mantiene feedback textual/cromático.

## Do's and Don'ts

### Do:
- **Do** reutilizar tokens y primitivas de `web/src/components/ui/`.
- **Do** verificar 1440 y 390 px, temas claro/oscuro y `prefers-reduced-motion`.
- **Do** enseñar fase y progreso real en generación, clasificación, unión y subidas.

### Don't:
- **Don't** usar amarillo como estado de tarea.
- **Don't** sustituir filas operativas por tarjetas grandes o anidadas.
- **Don't** animar por decoración ni ocultar cambios bajo una transición.
