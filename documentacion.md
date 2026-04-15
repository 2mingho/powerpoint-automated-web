# Documentación Técnica — Plataforma Data Intel

Este documento es la única fuente de la verdad para desarrolladores y testers. Cubre cada módulo, cada endpoint, cada función y cómo encajan todas las piezas. Última actualización: Marzo 2026.

---

## Tabla de Contenidos

- [Documentación Técnica — Plataforma Data Intel](#documentación-técnica--plataforma-data-intel)
  - [Tabla de Contenidos](#tabla-de-contenidos)
  - [1. Visión General de la Arquitectura](#1-visión-general-de-la-arquitectura)
  - [2. Modelos de Base de Datos](#2-modelos-de-base-de-datos)
    - [`User`](#user)
    - [`Report`](#report)
    - [`ActivityLog`](#activitylog)
    - [`ClassificationPreset`](#classificationpreset)
  - [3. Extensiones](#3-extensiones)
  - [4. Blueprint de Autenticación](#4-blueprint-de-autenticación)
  - [5. Blueprint de Administración](#5-blueprint-de-administración)
  - [6. Capa de Servicios](#6-capa-de-servicios)
    - [6.1 `file_loader.py`](#61-file_loaderpy)
      - [Constantes](#constantes)
      - [`detect_format(raw_bytes, filename) → dict`](#detect_formatraw_bytes-filename--dict)
      - [`read_full_as_tsv(raw_bytes, fmt) → (header_str, body_str)`](#read_full_as_tsvraw_bytes-fmt--header_str-body_str)
    - [6.2 `classifier.py`](#62-classifierpy)
      - [Formato de reglas](#formato-de-reglas)
      - [`classify_chunk(rows_text, header_text, rules_config, default_val, use_keywords, text_col, keywords_col) → DataFrame`](#classify_chunkrows_text-header_text-rules_config-default_val-use_keywords-text_col-keywords_col--dataframe)
      - [`classify_mentions(file_path, rules_config, default_val, use_keywords) → DataFrame`](#classify_mentionsfile_path-rules_config-default_val-use_keywords--dataframe)
      - [Ayudantes o helpers internos:](#ayudantes-o-helpers-internos)
    - [6.3 `calculation.py`](#63-calculationpy)
      - [`clean_dataframe(file_path) → DataFrame`](#clean_dataframefile_path--dataframe)
      - [`get_kpis(df) → dict`](#get_kpisdf--dict)
      - [Otras subfunciones](#otras-subfunciones)
    - [6.4 `csv_analysis.py`](#64-csv_analysispy)
    - [6.5 `file_merger.py`](#65-file_mergerpy)
    - [6.6 `groq_analysis.py`](#66-groq_analysispy)
  - [7. Rutas Principales de la Aplicación](#7-rutas-principales-de-la-aplicación)
    - [7.1 Generador de Reportes](#71-generador-de-reportes)
      - [`GET /`](#get-)
      - [`POST /`](#post-)
    - [7.2 Módulo de Clasificación](#72-módulo-de-clasificación)
      - [`POST /clasificacion/detect`](#post-clasificaciondetect)
      - [`POST /clasificacion/upload`](#post-clasificacionupload)
      - [`GET /clasificacion/upload_body/<session_id>`](#get-clasificacionupload_bodysession_id)
      - [`POST /clasificacion/chunk`](#post-clasificacionchunk)
      - [`POST /clasificacion/finalize`](#post-clasificacionfinalize)
      - [Presets](#presets)
    - [7.3 Módulo de Unión de Archivos](#73-módulo-de-unión-de-archivos)
    - [7.4 Módulo Análisis CSV](#74-módulo-análisis-csv)
    - [7.5 Rutas de Descarga y Utilidad](#75-rutas-de-descarga-y-utilidad)
  - [8. Plantillas del Frontend](#8-plantillas-del-frontend)
  - [9. Recursos Estáticos y Sistema de Diseño](#9-recursos-estáticos-y-sistema-de-diseño)
  - [10. Configuración y Entorno](#10-configuración-y-entorno)
  - [11. Seguridad](#11-seguridad)
  - [12. Suite de Pruebas](#12-suite-de-pruebas)

---

## 1. Visión General de la Arquitectura

```
Navegador
  │
  │  HTTP
  ▼
App Flask (app.py)
  ├── blueprints/auth.py        ← Inicio de Sesión / Cierre / Registro
  ├── blueprints/admin.py       ← Panel de admin y gestión de usuarios
  │
  ├── /                         ← Generador de reportes
  ├── /clasificacion/*          ← Clasificación de datos
  ├── /union/*                  ← Unión de archivos
  └── /analisis-csv             ← Análisis exploratorio de CSV
       │
       ▼
  services/
    ├── file_loader.py          ← Detección de formato (codificación + sep + tipo)
    ├── classifier.py           ← Motor de clasificación por palabras clave
    ├── calculation.py          ← Procesamiento de datos del reporte y KPIs
    ├── csv_analysis.py         ← Análisis exploratorio genérico
    ├── file_merger.py          ← Operaciones de unión de DataFrames
    └── groq_analysis.py        ← Llamadas a la API de Groq/Llama3
       │
       ▼
  pptx_builder/                 ← Wrappers de python-pptx y constructores de gráficos nativos
  instance/users.db             ← Base de datos SQLite
  scratch/                      ← Archivos temporales (subidas, salidas, sesiones)
```

**Ciclo de vida de una petición (ejemplo de clasificación):**
1. El navegador envía el archivo (POST) → `/clasificacion/detect` → `file_loader.detect_format()` → devuelve columnas + vista previa + codificación + separador.
2. El navegador envía el archivo completo (POST) → `/clasificacion/upload` → `file_loader.read_full_as_tsv()` → guarda un TSV en UTF-8 en `scratch/upload_<sid>.tsv`.
3. El navegador obtiene el cuerpo (GET) → `/clasificacion/upload_body/<sid>` → devuelve las filas del TSV como texto plano.
4. Por cada fragmento (*chunk*), el navegador envía (POST) → `/clasificacion/chunk` → `classifier.classify_chunk()` → añade al archivo `scratch/session_<sid>.csv`.
5. Por último, el navegador finaliza (POST) → `/clasificacion/finalize` → lee el CSV ensamblado, calcula estadísticas → devuelve la URL de descarga.

---

## 2. Modelos de Base de Datos

Archivo: `models.py`

### `User`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | Integer PK | |
| `username` | String(150) | Nombre a mostrar |
| `email` | String(150) | Único, usado para inicio de sesión |
| `password` | String(200) | Hasheado por Werkzeug |
| `role` | String(20) | `admin`, `DI`, `MW` |
| `is_active` | Boolean | Para deshabilitar usuarios lógicamente |
| `created_at` | DateTime | UTC |
| `allowed_tools` | Text | Lista JSON de claves de herramientas, `NULL` = todas |

**Métodos:**
- `has_tool_access(tool_key)` — devuelve `True` si el usuario puede acceder a la herramienta. Los administradores siempre devuelven `True`.
- `get_allowed_tools()` — devuelve la lista de claves permitidas.
- `set_allowed_tools(tool_keys)` — valida y guarda la lista de acceso como JSON.

**Claves de herramientas disponibles:** `reports`, `classification`, `file_merge`, `csv_analysis`.

---

### `Report`

Almacena metadatos para cada ZIP de reporte generado.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | Integer PK | |
| `filename` | String(255) | Nombre del archivo ZIP en `scratch/` |
| `title` | String(255) | Nombre del cliente/reporte |
| `description` | Text | Notas opcionales |
| `created_at` | DateTime | UTC |
| `template_name` | String(255) | Plantilla PPTX utilizada |
| `user_id` | FK → User | Propietario |

---

### `ActivityLog`

Cada acción importante del usuario se registra aquí.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK → User | |
| `action` | String(100) | Código corto, ej. `classify_data`, `file_merge` |
| `detail` | Text | Descripción legible por humanos |
| `ip_address` | String(45) | IPv4 o IPv6 |
| `timestamp` | DateTime | Indexado para rendimiento |

El registro se realiza mediante el helper `log_activity(action, detail)` definido en `app.py`.

---

### `ClassificationPreset`

Reglas de clasificación guardadas, por usuario.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK → User | |
| `name` | String(100) | Nombre a mostrar |
| `rules_json` | Text | Array JSON de forma `[{category, tematicas: [{name, keywords:[]}]}]` |
| `created_at` | DateTime | UTC |

**Método:** `get_rules()` — deserializa `rules_json` y devuelve la lista; devuelve `[]` en caso de error.

---

## 3. Extensiones

Archivo: `extensions.py`

```python
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager

db = SQLAlchemy()
login_manager = LoginManager()
```

Ambos objetos se crean en este archivo y se registran en la app en `app.py` para evitar importaciones circulares.

---

## 4. Blueprint de Autenticación

Archivo: `blueprints/auth.py` — registrado con prefijo `/`

| Ruta | Método | Descripción |
|---|---|---|
| `/login` | GET | Muestra el formulario de login |
| `/login` | POST | Valida credenciales, crea la sesión a través de Flask-Login |
| `/logout` | GET | Limpia la sesión, redirige al login |
| `/register` | GET | Muestra el formulario de registro |
| `/register` | POST | Crea un usuario nuevo con rol por defecto (no admin). El admin base se crea por `ADMIN_*` en el arranque si no existe. |

El hashing de contraseñas usa `werkzeug.security.generate_password_hash` (PBKDF2-SHA256).

---

## 5. Blueprint de Administración

Archivo: `blueprints/admin.py` — protegido por el decorador `@admin_required`

| Ruta | Método | Descripción |
|---|---|---|
| `/admin` | GET | Dashboard: lista de usuarios + resumen de actividad |
| `/admin/users` | GET | Tabla completa de usuarios con roles y accesos a herramientas |
| `/admin/users/new` | GET/POST | Crear un nuevo usuario |
| `/admin/users/<id>/edit` | GET/POST | Editar detalles, rol y acceso a herramientas de un usuario |
| `/admin/users/<id>/delete` | POST | Eliminación lógica (establece `is_active = False`) |
| `/admin/activity` | GET | Log de actividad paginado de todos los usuarios |

---

## 6. Capa de Servicios

Todos los servicios están alojados en `services/` y **no tienen importaciones de Flask** — son funciones Python puras que operan con datos. Esto las hace testeables de forma independiente.

---

### 6.1 `file_loader.py`

Responsable de detectar automáticamente el formato de archivo y de convertir cualquier archivo tabular en una cadena TSV en UTF-8 normalizada.

#### Constantes

```python
_ENCODINGS  = ['utf-16', 'utf-8', 'latin-1', 'cp1252']
_SEPARATORS = ['\t', ',', ';', '|']
```

#### `detect_format(raw_bytes, filename) → dict`

Detecta automáticamente el formato de un archivo tabular a partir de sus bytes sin procesar.

- Para `.xlsx`/`.xls`: intenta abrirlo con `openpyxl` y luego con `xlrd`.
- Para CSV/TXT: utiliza `chardet.detect()` en los primeros 8 KB como aproximación, luego aplica fuerza bruta con todas las combinaciones de `_ENCODINGS × _SEPARATORS`. Una combinación se da por buena cuando resulta en `shape[1] > 1` y `len(df) > 0` (al menos 2 columnas y 1 fila).

**Retorna:**
```json
{
  "file_type": "csv" | "xlsx" | "xls",
  "encoding": "utf-8" | "latin-1" | ... | null,
  "sep": "\t" | "," | ... | null,
  "columns": ["Col1", "Col2", ...],
  "preview": [{"Col1": "val", ...}, ...],   // primeras 5 filas
  "error": null | "mensaje de error"
}
```

#### `read_full_as_tsv(raw_bytes, fmt) → (header_str, body_str)`

Lee el archivo completo utilizando el diccionario de formato proveído por `detect_format()` (junto con las modificaciones manuales del usuario si las hay) y lo convierte en texto UTF-8 separado por tabulaciones (TSV).

- Retorna `(cadena_encabezado_con_salto_de_linea, texto_del_cuerpo)`.
- En caso de error, retorna `('', '')`.
- La salida **es siempre** UTF-8 TSV, independientemente de la codificación original. Este paso es el que normaliza el procesamiento posterior.

---

### 6.2 `classifier.py`

Motor de clasificación basado en palabras clave. Asigna a cada fila la **Categoría** y **Temática** acorde a reglas que establece el usuario.

#### Formato de reglas

```json
[
  {
    "category": "Economía",
    "tematicas": [
      { "name": "Inflación", "keywords": ["precios", "costo de vida", "canasta"] }
    ]
  }
]
```

La clasificación aplica la norma **"la primera coincidencia gana"**: una vez clasificada una mención, el resto de las reglas la ignoran.

---

#### `classify_chunk(rows_text, header_text, rules_config, default_val, use_keywords, text_col, keywords_col) → DataFrame`

La función principal de clasificación. Llamada una vez por cada fragmento (*chunk*) de subida de datos por la ruta `/clasificacion/chunk`.

**Parámetros:**

| Param | Tipo | Por Defecto | Descripción |
|---|---|---|---|
| `rows_text` | str | — | Filas en formato TSV (sin encabezado) |
| `header_text` | str | — | Fila con los nombres de las columnas (con un `\n` al final) |
| `rules_config` | list | — | Lista de diccionarios de categorías y temáticas |
| `default_val` | str | `"Sin Clasificar"` | Etiqueta en caso de no coincidir |
| `use_keywords` | bool | `False` | Habilitar segunda pasada por palabras clave |
| `text_col` | str | `"Hit Sentence"` | Columna donde hacer buúsqueda (nombre que da el usuario) |
| `keywords_col` | str | `""` | Columna opcional de palabras clave para segunda pasada |

**Lógica:**
1. `_load_chunk_df()` — convierte de cadena TSV a DataFrame, detecta el separador, renombra la columna origen a `Hit Sentence` y `Keywords`.
2. Si `Hit Sentence` no hay valores o es nula, se usa `Headline` como alternativa si se detecta.
3. Se inicializa las columnas `Tematica` y `Categoria` con el  `default_val`.
4. **Pasada 1** — Llama `_apply_rules()` sobre el `Hit Sentence`.
5. **Pasada 2** (si `use_keywords=True`) — Llama a `_apply_rules()` sobre la columna elegida como `Keywords`, aplicable estrictamente sobre las filas que quedaron en su valor con defecto.

Retorna un DataFrame de todas sus columnas iniciales más `Tematica` e `Categoria` insertas.

---

#### `classify_mentions(file_path, rules_config, default_val, use_keywords) → DataFrame`

Alternativa clásica (archivo completo a memoria). Usada para la versión rápida de la API de clasificación.

---

#### Ayudantes o helpers internos:
- `_detect_sep(header)`
- `_load_chunk_df(rows_text, header_text, text_col, keywords_col)`
- `_apply_rules(df, text_col, rules_config, default_val)` (Lanza los bucles más ligeros mediante vectores).

---

### 6.3 `calculation.py`

Carga general y matemática orientada al generador de Power Points. (Usa formato TSV nativo UTF-16 originario).

#### `clean_dataframe(file_path) → DataFrame`

Se ocupa de arreglar toda la data social provista:

- Intenta abrir como UTF-16, y, en caso contrario, intenta UTF-8.
- Elimina docenas de columnas de red que no influyen.
- Mapea de la columna `Source` a `Plataforma` (`Redes Sociales` / `Prensa Digital`) a través de un diccionario local llamado `SOCIAL_NETWORK_SOURCES`.
- Converte alcances ("Reach") a formato flotante o numérico rellenándolo en `0` frente a NaNs.

#### `get_kpis(df) → dict`

- Retorna sumatorias y numéricos globales: totales menciones, autores topes y alcances numéricos absolutos con un totalizador.

#### Otras subfunciones
- `get_evolution_data(df, use_date_only) → dict` — Recopila datos del tiempo y la fecha local según el booleano `date`.
- `get_sentiment_data(df) → list` — Regrupa la positividad y colorea (`"#ad0303", "#07ab50"` etc).
- `get_top_tables(df) → dict` — Filtra en base al autor y el canal en listados Top.

---

### 6.4 `csv_analysis.py`

Revisa archivo al azar e iterativiza a base su peso usando NumPy / Chartjs. Para la URL de `/analisis-csv`.

**Puntos Generales (dict JSON principal retornado):**
- Informaciones generales: (`"row_count": ..., "column_count": ..., "memory_usage_mb": ...` , además de identificar por el data type en base al panda)
- Recuento detallado sobre los campos omitidos e informes nulos. (`total_missing_cells`) 
- Resumen analítico por métrica (`mean`, `std`, `kurtosis`, `skweness`) sobre datos puros numericos y distribuciones absolutas (Histogram).
- Analisis combinados.

---

### 6.5 `file_merger.py` 

Combina Dataframes. Formatos aceptados desde CSVs hasta .Xlsx / .Xls.

**Métodos claves de operación:**
- `merge_default()` Usa la concatenación por nombre y ordena rellenado con `NaNs`. 
- `merge_advanced()` Ejecuta a base a tu lista o diccionarios donde mapea B contra A de manera visual: A `{Columna X}` toma el lugar a lo que se extrae del segundo archivo.

---

### 6.6 `groq_analysis.py` 

Utilidad ligada a la red por LLMs. (Se recomienda `LLAMA3-70b` por la vía `https://api.groq.com/openai/v1/chat`). Recibe hasta 80 de los comentarios para deducir una inteligencia semantica sobre el conjunto exportado mediante una matriz o esquema predeterminado en `construir_prompt`.

---

## 7. Rutas Principales de la Aplicación

Archivo core base: `app.py`. En general casi en todas exige el rol `@login_required` a menos que sean un hook para los utilitarios de inicio de sesión o un control general como ser del modulo "Tools", caso en es verificado dentro decorador `@tool_required('tool_key')`.

---

### 7.1 Generador de Reportes

#### `GET /`

Carga de inmediato el Index con el form HTML visual con su bloque para enviar tu input. Alimenta del DB (tabla `Report`).

#### `POST /`

**Proceso del Pipeline interno:** Recibe inputs (campos de archivo, imágenes (wordcloud), textos puros). Lanza internamente el paso de: `calculation` para crear el json base, la extracción AI a través de Groq, abre tu ppt en bytes internos en ram, hace buscar+reemplazar a través de la librería, mete sus componentes y entrega por final a formato .zip tras ensamblar.

---

### 7.2 Módulo de Clasificación

Rutas condicionadas a `@tool_required('classification')`. 

#### `POST /clasificacion/detect`
Da vista previa y detecta cómo fue fabricado el CSV. (No altera, solo responde).

#### `POST /clasificacion/upload`
Maneja en general todas las subidas al back-end ya sea UTF, CP o en formato XLS para esquematizarlas primero como Tsv, respondiendote con session_ids para evitar re-lecturas locales en javascript (file.text), lo que garantiza decodificaciones precisas de inicio.

#### `GET /clasificacion/upload_body/<session_id>`
Devuelve la trama procesada (filas sin la primera linea cabezote) hacia la RAM de internet y el navegador como plano texto, logrando así que al repartir en `chunks` en JS en cliente se corra suave para mandarlo a `chunk/`.

#### `POST /clasificacion/chunk`
Pila principal de ida. Recibe trozos de data mas rules del usuario y responde a tu front la "partial stat" por bucle y reescribe temporalmente lo que sale adentro para formar tu CSV nuevo final.

#### `POST /clasificacion/finalize`
Agrupa las cuentas (totales) al final del ciclo de "chunks", da formato total en el directorio scratch del archivo sumando una copia de todo.

#### Presets 
Otras rutas HTTP operativas con la base local para que los settings sean memorizables:
- GET o POST / DELETE `/clasificacion/presets` o su id para CRUD en la respectiva base y re-pasarla como Arrays Json a memoria.


---

### 7.3 Módulo de Unión de Archivos

Rutas condicionadas a `@tool_required('file_merge')`.

- `/union` Base visual.
- `/union/detect` Semejante mecanismo de detección automática para orientar listados por tu pantalla.
- `/union/merge` (Diferenciado internamente como modo 'advanced' vs el convencional 'default'), mapeando y concatenando internamente tu archivo.

---

### 7.4 Módulo Análisis CSV

Rutas condicionadas a `@tool_required('csv_analysis')`. Permite ver graficas e información directa de tabla en `/analisis-csv` lanzando cálculos cruzados.

---

### 7.5 Rutas de Descarga y Utilidad

Endpoints especiales con seguridad local antienvenamientos:
La herramienta remueve cosas de mas 1 hora via `clean_scratch_folder` el momento en su hook de `@after_this_request` sobre los GET paths:

- `GET /download/<file>` 
- `GET /download_classified/...` (Recibe la llave real e inyecta la cabecera original del nombre para un confort natural en Browser al oprimir descargas.)

---

## 8. Plantillas del Frontend

Jinja HTML central: `base.html` como matriz y menús, o `base_auth` (Logins). El usuario visualiza de forma controlada sus features por la validación en variable que trae la vista del DB (Ej. `has_tool_access`).

El JavaScript maneja las iteraciones en Arrays nativas y el DOM se autoedita bajo lógicas Reactivas a través de EventListeners: Ejemplo principal se lo llevan arrays visuales de rules o Categorias que al teclear renuevan partes graficas enteras con funciones llamadas genéricamente "Renders" u otras lógicas por botones de Fetch (`postJson`). En Clasificación el "Settings Panel / Overrides" envía tu elección forzada a ser ejecutada como upload para solventar errores auto-detectables.

--- 

## 9. Recursos Estáticos y Sistema de Diseño

Usado vía `style.css` 100% nativa de variables y clases estables de diseño por:

```css
  --c-primary: #fadf25; 
  --c-text-primary: #1e293b;
```

Las grillas (`.form-row` y `.card`), con las iteraciones ligeras (`.animate-fade`). No precisa usar mas css.


---

## 10. Configuración y Entorno

- **`SECRET_KEY`**: Absolutamente forzada y crashea si lo olvidas en modo de producción para garantizar session cryptografica a prueba del acceso general.
- **`GROQ_API_KEY`**: Variable para habilitar funciones lógicas y conectividad a Meta (Llama 3).
- **`DATABASE_URL`**: Recomendado para producción (Neon/Postgres). Si falta, la app cae a SQLite local (`instance/users.db`).
- **`ACTIVITY_LOG_RETENTION_DAYS` / `ACTIVITY_LOG_MAX_ROWS`**: Controlan retención y tope de logs para limitar almacenamiento.
- Todas las salidas están dadas a crearse en base al limite interno de red a traves del var de App `MAX_CONTENT_LENGTH` de `200 * 1024 * 1024` megabytes (200MBs) evitando llenados forzosos no intencionados.

---

## 11. Seguridad

La plataforma es protegida en cinco vías funcionales del API: Logueo, Autorización Per-Ruta (via role check list db variables JSON), Traversal/Hack Paths reescribiendolos bajo función nativa Werkzeug `secure_filename()` donde no caben dobles punto o slashes mal intencionados al crear, limitar tamaños vía memoria a tope global y rate_limits en zonas débiles vía limiter API en Python.
 

---

## 12. Suite de Pruebas

Los archivos modulares pueden ejecutarse en consolas simples usando el ambiente general `pytest tests/ -v`.
Test de lógica evalúa la primera regla contra pasadas repetidas así como escenarios para testar el formato auto generado frente cruces y mal cruces y fallos.
Test API para Groq reacciona simulando llamadas y los conectores test env validan que `users.db` o tu directorio final funcionen normal.
