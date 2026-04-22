# Contrast Tokens (UX/UI)

Guia corta para mantener legibilidad consistente en claro/oscuro, especialmente en acciones de Admin.

| Token / Estado | Claro | Oscuro | Uso recomendado | Objetivo |
|---|---|---|---|---|
| `--c-text` | `#1b2330` | `#e7ebf1` | Texto principal en superficies | AA cuerpo (>= 4.5:1) |
| `--c-text-secondary` | `#5f6b7b` | `#a4afbf` | Texto secundario, hints | AA para texto secundario |
| `--c-border` | `#d4d9e1` | `#2a3240` | Bordes de inputs/paneles | Separacion visual clara |
| `btn-primary` | bg `#1b2330`, txt `#f8fafc` | bg `#1b2330`, txt `#f8fafc` | Accion principal | AA en label |
| `btn-primary:hover` | bg `#111823` | bg `#111823` | Hover principal | Mantener contraste alto |
| `btn-secondary` | bg `var(--c-white)`, txt `var(--c-text)` | bg `var(--c-white)`, txt `var(--c-text)` | Accion secundaria | AA en label |
| `btn-secondary:hover` | bg `#f8fafd`, txt `var(--c-text)` | bg `#1d2531`, txt `#e7ebf1` | Hover secundario | Evitar perdida de legibilidad |
| `btn-outline` | bg `transparent`, border `var(--c-border)`, txt `var(--c-text)` | bg `transparent`, border `var(--c-border)`, txt `var(--c-text)` | Acciones auxiliares | AA en label |
| `btn-outline:hover` | bg `#f7f9fc`, txt `var(--c-text)` | bg `#1b2330`, txt `#f1f5f9` | Hover auxiliar | Alto contraste en ambos temas |
| `admin-toolbar btn-outline` | bg `var(--c-white)`, border `#c2cad6`, txt `#1b2330` | bg `#151a22`, border `#334155`, txt `#dbe3ef` | Botones de Quick Actions admin | Legibilidad reforzada |
| `admin-toolbar btn-outline:hover` | bg `#eef2f7`, txt `#111823` | bg `#1f2937`, txt `#f8fafc` | Hover en toolbar admin | Sin degradar lectura |
| `focus-ring-light` | `0 0 0 3px rgba(143,157,176,0.24)` | - | Foco teclado en claro | Visible sin ruido |
| `focus-ring-dark` | - | `0 0 0 3px rgba(100,116,139,0.32)` | Foco teclado en oscuro | Visible sobre fondos oscuros |

## Reglas rapidas

1. No usar texto claro sobre fondos claros ni texto oscuro sobre fondos oscuros en `hover`.
2. Mantener `:focus-visible` en todos los botones interactivos (teclado/accesibilidad).
3. En Admin, priorizar legibilidad sobre sutileza visual en botones de accion.
4. Si creas un nuevo variante de boton, replicar pares `default/hover/focus-visible` para claro y oscuro.

## Checklist minimo de QA visual

- Claro: toolbar admin legible en `default`, `hover`, `focus-visible`.
- Oscuro: toolbar admin legible en `default`, `hover`, `focus-visible`.
- Navegacion por teclado: foco siempre visible.
- Texto de botones: no menor a 0.88rem para acciones principales.
