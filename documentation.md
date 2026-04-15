# Technical Documentation — Data Intel Platform

This document is the single source of truth for developers and testers. It covers every module, every endpoint, every function, and how all the pieces fit together. Last updated: March 2026.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Models (`models.py`)](#2-database-models)
3. [Extensions (`extensions.py`)](#3-extensions)
4. [Authentication Blueprint (`blueprints/auth.py`)](#4-authentication-blueprint)
5. [Admin Blueprint (`blueprints/admin.py`)](#5-admin-blueprint)
6. [Service Layer](#6-service-layer)
   - [file_loader.py](#61-file_loaderpy)
   - [classifier.py](#62-classifierpy)
   - [calculation.py](#63-calculationpy)
   - [csv_analysis.py](#64-csv_analysispy)
   - [file_merger.py](#65-file_mergerpy)
   - [groq_analysis.py](#66-groq_analysispy)
7. [Main Application Routes (`app.py`)](#7-main-application-routes)
   - [Report Generator](#71-report-generator)
   - [Classification Module](#72-classification-module)
   - [File Merge Module](#73-file-merge-module)
   - [CSV Analysis Module](#74-csv-analysis-module)
   - [Download & Utility Routes](#75-download--utility-routes)
8. [Frontend Templates](#8-frontend-templates)
9. [Static Assets & Design System](#9-static-assets--design-system)
10. [Configuration & Environment](#10-configuration--environment)
11. [Security](#11-security)
12. [Test Suite](#12-test-suite)

---

## 1. Architecture Overview

```
Browser
  │
  │  HTTP
  ▼
Flask app (app.py)
  ├── blueprints/auth.py        ← Login / Logout / Register
  ├── blueprints/admin.py       ← Admin dashboard & user management
  │
  ├── /                         ← Report generator
  ├── /clasificacion/*          ← Data classification
  ├── /union/*                  ← File merge
  └── /analisis-csv             ← CSV analysis
       │
       ▼
  services/
    ├── file_loader.py          ← Format detection (encoding + sep + file type)
    ├── classifier.py           ← Keyword classification engine
    ├── calculation.py          ← Report data processing & KPIs
    ├── csv_analysis.py         ← Generic exploratory analysis
    ├── file_merger.py          ← DataFrame merge operations
    └── groq_analysis.py        ← Groq/Llama3 API calls
       │
       ▼
  pptx_builder/                 ← Python-pptx wrappers & native chart builders
  instance/users.db             ← SQLite database
  scratch/                      ← Temporary files (uploads, outputs, sessions)
```

**Request lifecycle (classification example):**
1. Browser POSTs file → `/clasificacion/detect` → `file_loader.detect_format()` → returns columns + preview + encoding + sep.
2. Browser POSTs file → `/clasificacion/upload` → `file_loader.read_full_as_tsv()` → stores UTF-8 TSV in `scratch/upload_<sid>.tsv`.
3. Browser GETs body → `/clasificacion/upload_body/<sid>` → returns TSV rows as plain text.
4. For each chunk, browser POSTs → `/clasificacion/chunk` → `classifier.classify_chunk()` → appends to `scratch/session_<sid>.csv`.
5. Browser POSTs → `/clasificacion/finalize` → reads assembled CSV, computes stats → returns download URL.

---

## 2. Database Models

File: `models.py`

### `User`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `username` | String(150) | Display name |
| `email` | String(150) | Unique, used for login |
| `password` | String(200) | Hashed by Werkzeug |
| `role` | String(20) | `admin`, `DI`, `MW` |
| `is_active` | Boolean | Soft-disable users |
| `created_at` | DateTime | UTC |
| `allowed_tools` | Text | JSON list of tool keys, `NULL` = all tools |

**Methods:**
- `has_tool_access(tool_key)` — returns `True` if user can access the given tool key. Admins always return `True`.
- `get_allowed_tools()` — returns list of allowed tool keys.
- `set_allowed_tools(tool_keys)` — validates and persists tool access list as JSON.

**Available tool keys:** `reports`, `classification`, `file_merge`, `csv_analysis`.

---

### `Report`

Stores metadata for each generated report ZIP.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `filename` | String(255) | ZIP filename in `scratch/` |
| `title` | String(255) | Client/report name |
| `description` | Text | Optional notes |
| `created_at` | DateTime | UTC |
| `template_name` | String(255) | PPTX template used |
| `user_id` | FK → User | Owner |

---

### `ActivityLog`

Every significant user action is logged here.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK → User | |
| `action` | String(100) | Short code, e.g. `classify_data`, `file_merge` |
| `detail` | Text | Human-readable description |
| `ip_address` | String(45) | IPv4 or IPv6 |
| `timestamp` | DateTime | Indexed for performance |

Logging is done via the helper `log_activity(action, detail)` defined in `app.py`.

---

### `ClassificationPreset`

Saved classification rule sets, scoped per user.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `user_id` | FK → User | |
| `name` | String(100) | Display name |
| `rules_json` | Text | JSON array `[{category, tematicas: [{name, keywords:[]}]}]` |
| `created_at` | DateTime | UTC |

**Method:** `get_rules()` — deserializes `rules_json` and returns the list; returns `[]` on error.

---

## 3. Extensions

File: `extensions.py`

```python
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager

db = SQLAlchemy()
login_manager = LoginManager()
```

Both objects are created here and registered on the `app` in `app.py` to avoid circular imports.

---

## 4. Authentication Blueprint

File: `blueprints/auth.py` — registered at `/`

| Route | Method | Description |
|---|---|---|
| `/login` | GET | Renders login form |
| `/login` | POST | Validates credentials, creates session via Flask-Login |
| `/logout` | GET | Clears session, redirects to login |
| `/register` | GET | Renders registration form |
| `/register` | POST | Creates new user. First user automatically gets `admin` role |

Password hashing uses `werkzeug.security.generate_password_hash` (PBKDF2-SHA256).

---

## 5. Admin Blueprint

File: `blueprints/admin.py` — protected by `@admin_required` decorator

| Route | Method | Description |
|---|---|---|
| `/admin` | GET | Dashboard: user list + activity summary |
| `/admin/users` | GET | Full user table with role and tool access |
| `/admin/users/new` | GET/POST | Create a new user |
| `/admin/users/<id>/edit` | GET/POST | Edit user details, role, and tool access |
| `/admin/users/<id>/delete` | POST | Soft-delete (sets `is_active = False`) |
| `/admin/activity` | GET | Paginated activity log across all users |

---

## 6. Service Layer

All services live in `services/` and have **no Flask imports** — they are pure Python functions that operate on data. This makes them independently testable.

---

### 6.1 `file_loader.py`

Responsible for auto-detecting file format and converting any tabular file to a normalized UTF-8 TSV string.

#### Constants

```python
_ENCODINGS  = ['utf-16', 'utf-8', 'latin-1', 'cp1252']
_SEPARATORS = ['\t', ',', ';', '|']
```

#### `detect_format(raw_bytes, filename) → dict`

Auto-detects the format of a tabular file from its raw bytes.

- For `.xlsx`/`.xls`: tries `openpyxl` then `xlrd`.
- For CSV/TXT: uses `chardet.detect()` on the first 8 KB as a hint, then brute-forces all `_ENCODINGS × _SEPARATORS` combinations. A combination is accepted when it yields `shape[1] > 1` and `len(df) > 0` (i.e., at least 2 columns and 1 data row).

**Returns:**
```json
{
  "file_type": "csv" | "xlsx" | "xls",
  "encoding": "utf-8" | "latin-1" | ... | null,
  "sep": "\t" | "," | ... | null,
  "columns": ["Col1", "Col2", ...],
  "preview": [{"Col1": "val", ...}, ...],   // first 5 rows
  "error": null | "error message"
}
```

#### `read_full_as_tsv(raw_bytes, fmt) → (header_str, body_str)`

Reads the entire file using the format dict produced by `detect_format()` (with any manual overrides already applied) and converts it to UTF-8 tab-separated text.

- Returns `(header_line_with_newline, body_text)`.
- Returns `('', '')` on any error.
- The output is always UTF-8 TSV regardless of the input encoding — this is the normalization step that makes downstream processing encoding-agnostic.

---

### 6.2 `classifier.py`

Keyword-based classification engine. Assigns each data row a **Categoria** and **Tematica** based on user-defined rules.

#### Rules format

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

Classification is **first-match-wins**: once a row is assigned, it is skipped by subsequent rules.

---

#### `classify_chunk(rows_text, header_text, rules_config, default_val, use_keywords, text_col, keywords_col) → DataFrame`

The primary classification function. Called once per chunk by the `/clasificacion/chunk` route.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `rows_text` | str | — | TSV data rows (no header) |
| `header_text` | str | — | TSV header line (with trailing `\n`) |
| `rules_config` | list | — | List of category+tematica dicts |
| `default_val` | str | `"Sin Clasificar"` | Label for unmatched rows |
| `use_keywords` | bool | `False` | Enable second-pass keyword search |
| `text_col` | str | `"Hit Sentence"` | Column to search in (user-mapped name) |
| `keywords_col` | str | `""` | Optional keywords column |

**Processing:**
1. `_load_chunk_df()` — parses the TSV, auto-detects separator from the header, renames user-mapped columns to canonical names (`Hit Sentence`, `Keywords`).
2. If `Hit Sentence` missing, fills from `Headline` if available.
3. Initializes `Tematica` and `Categoria` columns with `default_val`.
4. **Pass 1** — `_apply_rules()` on `Hit Sentence`.
5. **Pass 2** (if `use_keywords=True`) — `_apply_rules()` on `Keywords` column, only for rows still at `default_val`.

Returns a DataFrame with all original columns plus `Tematica` and `Categoria`.

---

#### `classify_mentions(file_path, rules_config, default_val, use_keywords) → DataFrame`

Legacy full-file variant. Used by the report generator (POST `/clasificacion`). Reads the file via `calculation.clean_dataframe()` instead of `file_loader`. Not used by the chunked classification UI flow.

---

#### Internal helpers

| Function | Description |
|---|---|
| `_detect_sep(header)` | Counts candidate separator chars in the header and returns the most frequent |
| `_load_chunk_df(rows_text, header_text, text_col, keywords_col)` | Parses chunk + renames columns |
| `_apply_rules(df, text_col, rules_config, default_val)` | Vectorized rule application in-place |

---

### 6.3 `calculation.py`

Data processing for the report generator. Expects social listening exports in UTF-16 TSV format (Meltwater standard).

#### `clean_dataframe(file_path) → DataFrame`

Loads and normalizes a social listening CSV.

- Tries UTF-16 first, falls back to UTF-8.
- Drops irrelevant columns (reach breakdowns, social echoes, etc.).
- Fills empty `Hit Sentence` from `Headline` where available.
- Maps `Source` to `Plataforma` (`Redes Sociales` / `Prensa Digital`) using `SOCIAL_NETWORK_SOURCES` dict.
- Converts `Reach` to numeric, filling NaN with 0.

#### `get_kpis(df) → dict`

Returns: `total_mentions`, `unique_authors`, `estimated_reach` (sum of per-influencer max reach), `estimated_reach_fmt`, `mentions_prensa`, `mentions_redes`.

#### `get_evolution_data(df, use_date_only) → dict`

- `use_date_only=False` (default): groups by hour bucket using the `Date` column.
- `use_date_only=True`: groups by date using `Alternate Date Format`.
- Returns `{ labels: [...], values: [...] }` for Chart.js.

#### `get_sentiment_data(df) → list`

Counts Positive/Negative/Neutral sentiment (excluding "Not Rated"). Returns list of `{ label, value, color }` dicts.

#### `get_top_tables(df) → dict`

Returns:
- `top_prensa` — top 10 Prensa Digital sources by post count.
- `top_redes` — top 10 Redes Sociales sources by post count + max reach.
- `top_sentences` — top 5 hit sentences from Prensa Digital by reach (wrapped at 100 chars).

#### `format_number(number) → str`

Formats integers as `"1.5M"`, `"850k"`, or plain string.

#### `create_report_context(file_path, report_title) → dict`

Orchestrator for the interactive editor. Combines all the above into a single JSON-serializable context with keys: `meta`, `kpis`, `charts`, `tables`, `ai_analysis`.

---

### 6.4 `csv_analysis.py`

Generic statistical analysis for any tabular CSV. Used by the `/analisis-csv` tool.

#### `analyze_csv(file_path, encoding, separator) → dict`

Main orchestrator. Returns:

```json
{
  "success": true,
  "version": "1.0.2",
  "timestamp": "...",
  "file_info": { "file_size_bytes": ..., "file_size_mb": ..., "encoding_used": ..., "separator_used": ... },
  "general": { "row_count": ..., "column_count": ..., "columns": [...], "memory_usage_mb": ..., "dtypes": {...}, "numeric_columns": [...], "categorical_columns": [...] },
  "missing": { "total_missing_cells": ..., "total_missing_percentage": ..., "columns_with_missing": [...], "columns_fully_complete": [...] },
  "numeric": { "columns": [...], "stats": [{ "column": ..., "count": ..., "mean": ..., "median": ..., "std": ..., "min": ..., "max": ..., "q25": ..., "q75": ..., "skewness": ..., "kurtosis": ... }] },
  "categorical": { "columns": [...], "stats": [{ "column": ..., "unique_count": ..., "most_common": ..., "most_common_count": ..., "top_5_values": {...} }] },
  "correlation": { "columns": [...], "matrix": [{ "column": ..., "correlations": {...} }] },
  "distributions": { "numeric": [...], "categorical": [...] }
}
```

#### Supporting functions

| Function | Description |
|---|---|
| `load_csv(file_path, encoding, separator)` | Loads file, returns `(df, load_info)` |
| `general_info(df)` | Shape, dtypes, memory |
| `missing_analysis(df)` | Per-column missing counts and percentages |
| `numeric_stats(df)` | Mean, median, std, min, max, Q25, Q75, skewness, kurtosis |
| `categorical_stats(df)` | Unique count, most common value + frequency, top-5 |
| `correlation_matrix(df)` | Pearson correlation for all numeric columns |
| `distribution_data(df, max_columns)` | Histogram bins + counts for Chart.js (up to 10 cols) |
| `categorical_distribution(df, max_columns)` | Top-10 value counts per categorical column |
| `generate_summary_csv(analysis_result, output_path)` | Writes a downloadable summary CSV |
| `safe_float(value, decimals)` | NaN/inf-safe float conversion for JSON serialization |

---

### 6.5 `file_merger.py`

Merges 2+ tabular files. Supports CSV/TXT and Excel with automatic or manual encoding/separator.

#### `read_file(raw_bytes, filename, encoding, sep) → DataFrame`

Entry point. Dispatches to `_read_excel()` or `_read_csv()` based on file extension.

- If `encoding` or `sep` is `None`, auto-detection is used.

#### `_read_excel(raw_bytes, ext) → DataFrame`

Tries `openpyxl` for `.xlsx`, `xlrd` for `.xls`. Raises `ValueError` on failure.

#### `_read_csv(raw_bytes, encoding, sep) → DataFrame`

Brute-forces `encodings × separators` until a valid DataFrame is found. Uses `_detect_encodings()` for the candidate list.

#### `merge_default(dataframes) → DataFrame`

Concatenates a list of DataFrames using `pd.concat(ignore_index=True, sort=False)`. Normalizes column names (strip whitespace). Missing columns between files are filled with NaN.

#### `merge_advanced(df_a, df_b, mapping) → DataFrame`

Merges two DataFrames with different structures.

- `mapping` is `{ df_b_column: df_a_column }`.
- Only mapped columns from `df_b` are kept and renamed to match `df_a`.
- Raises `ValueError` if mapping is empty or has no valid column matches.

#### `save_merged(df, output_path, encoding, sep) → None`

Saves merged DataFrame as CSV (default: UTF-16 TSV).

---

### 6.6 `groq_analysis.py`

Integration with the Groq cloud AI API (Llama3-70b-8192) for qualitative social-listening insights.

#### `construir_prompt(entidad, menciones) → str`

Builds a structured Spanish-language prompt requesting a JSON response with:
- `temas_principales`: list of `{tema, descripcion}`
- `sentimiento_general`: `{positivo, negativo, neutro}` each with percentage + example
- `hallazgos_destacados`: free-text summary

#### `llamar_groq(prompt) → str | None`

POSTs to `https://api.groq.com/openai/v1/chat/completions` with `temperature=0.3`. Returns raw response text or `None` on HTTP error.

#### `extraer_json(respuesta) → dict | str | None`

Extracts the first `{...}` block from the response using regex and parses it. Returns the parsed dict, the raw string on JSON parse failure, or `None` if no JSON block found.

#### `formatear_analisis_social_listening(data) → str`

Converts the parsed Groq JSON dict into a plain-text multi-paragraph string suitable for embedding in PowerPoint shapes.

---

## 7. Main Application Routes

File: `app.py`. All routes require `@login_required` unless noted. Tool-specific routes additionally require `@tool_required('tool_key')`.

### Access control decorators

| Decorator | Behavior |
|---|---|
| `@login_required` | Flask-Login standard. Redirects to `/login` for page requests; returns `401 JSON` for AJAX. |
| `@tool_required('key')` | Checks `current_user.has_tool_access(key)`. Redirects to `/` with flash for pages; returns `403 JSON` for AJAX. |

---

### 7.1 Report Generator

#### `GET /`

Renders `index.html`. Loads available PPTX templates from `powerpoints/`. Lists user's saved reports from the `Report` table.

#### `POST /`

Accepts a multipart form with:

| Field | Type | Description |
|---|---|---|
| `csv_file` | File | Social listening CSV (UTF-16 TSV expected) |
| `wordcloud_image` | File (optional) | PNG/JPEG wordcloud image |
| `template_name` | str | PPTX template filename |
| `report_title` | str | Client/project name |
| `description` | str (optional) | Notes stored in DB |
| `solo_fecha` | checkbox | Use date-only (no hour) granularity for evolution chart |

**Processing via `process_report()`:**
1. `calculation.clean_dataframe()` — load and normalize data.
2. KPI calculation, chart data, influencer tables, top hit sentences.
3. Open PPTX template, build single-pass placeholder index.
4. Replace text placeholders: `REPORT_CLIENT`, `REPORT_DATE`, `NUMB_MENTIONS`, `NUMB_ACTORS`, `EST_REACH`.
5. Generate native line chart for `CONVERSATION_CHART`.
6. Generate native pie chart for `SENTIMENT_PIE`.
7. Place wordcloud image at `WORDCLOUD`.
8. Write AI analysis text to `CONVERSATION_ANALISIS` (Groq API call with first 80 hit sentences).
9. Build influencer tables at `TOP_INFLUENCERS_PRENSA_TABLE`, `TOP_INFLUENCERS_REDES_POSTS_TABLE`, `TOP_INFLUENCERS_REDES_REACH_TABLE`.
10. Save PPTX + processed CSV into a ZIP in `scratch/`.
11. Persist `Report` record in DB.

**Response:** JSON `{ success, download_url, missing_fields: [...] }`.

#### `GET /mis-reportes`

Returns `mis_reportes.html` with the user's report history.

---

### 7.2 Classification Module

All routes require `@tool_required('classification')`.

#### `GET /clasificacion`

Renders `clasificacion.html`.

#### `POST /clasificacion` (legacy)

Legacy single-file classification via form submit. Calls `classify_mentions()` directly. Still present but superseded by the chunked flow in the UI.

#### `POST /clasificacion/detect`

Auto-detects file format without classifying.

**Request:** multipart, field `csv_file`.

**Response:**
```json
{
  "success": true,
  "columns": ["Col1", "Col2"],
  "preview": [{"Col1": "...", ...}],
  "encoding": "latin-1",
  "sep": ",",
  "file_type": "csv"
}
```

---

#### `POST /clasificacion/upload`

Receives the full file, reads it properly with server-side encoding handling, and stores it as UTF-8 TSV for chunked processing.

**Why this exists:** The browser's `file.text()` API always decodes as UTF-8, corrupting Latin-1/CP1252 files and failing on binary Excel files. This route uses `file_loader.read_full_as_tsv()` to handle decoding correctly.

**Request:** multipart with:
| Field | Description |
|---|---|
| `csv_file` | The uploaded file (any format) |
| `encoding` | (optional) Manual encoding override, e.g. `latin-1` |
| `sep` | (optional) Manual separator override, e.g. `;` |

**Processing:**
1. `detect_format()` — auto-detect format.
2. Apply manual `encoding`/`sep` overrides if provided.
3. `read_full_as_tsv()` — decode and convert to UTF-8 TSV. Store as `scratch/upload_<session_id>.tsv`.

**Response:**
```json
{
  "success": true,
  "session_id": "a3f8d...",
  "header": "Col1\tCol2\t...\n",
  "total_rows": 5420,
  "total_chunks": 3,
  "chunk_size": 2000
}
```

---

#### `GET /clasificacion/upload_body/<session_id>`

Returns the body of the stored UTF-8 TSV (all rows after the header) as `text/plain`.

Used by the frontend to split the data into chunks without ever touching the raw binary file again. The `session_id` is path-sanitized via `secure_filename()`.

---

#### `POST /clasificacion/chunk`

Classifies one batch of rows and appends the classified output to a session CSV file.

**Request body (JSON):**
```json
{
  "session_id": "a3f8d...",
  "header": "Col1\tCol2\t...\n",
  "rows": "row1val1\trow1val2\n...",
  "rules": [ { "category": "...", "tematicas": [...] } ],
  "default_val": "Sin Clasificar",
  "use_keywords": false,
  "chunk_index": 0,
  "text_col": "Hit Sentence",
  "keywords_col": ""
}
```

**Processing:**
1. `classifier.classify_chunk()` — classifies the rows.
2. Appends to `scratch/session_<session_id>.csv` (UTF-16 TSV). First chunk writes the header.

**Response:**
```json
{
  "success": true,
  "partial_stats": { "Economía": { "total": 42, "tematicas": { "Inflación": 30 } } },
  "rows_in_chunk": 2000
}
```

---

#### `POST /clasificacion/finalize`

Reads the assembled session CSV, computes final stats, and makes the file available for download.

**Request body (JSON):** `{ session_id, original_name, default_val, total_rows }`

**Processing:**
1. Reads `scratch/session_<session_id>.csv`.
2. Computes grouped category/tematica counts.
3. Renames file to `scratch/classified_<session_id>.csv`.

**Response:**
```json
{
  "success": true,
  "download_url": "/download_classified/...",
  "stats": { ... },
  "total_rows": 5420,
  "insights": { "top_category": "Economía", "top_count": 312 }
}
```

---

#### Classification Preset Endpoints

| Route | Method | Description |
|---|---|---|
| `/clasificacion/presets` | GET | List user's presets ordered by `created_at` desc |
| `/clasificacion/presets` | POST | Create preset. Body: `{ name, rules }` |
| `/clasificacion/presets/<id>` | GET | Load preset rules by ID |
| `/clasificacion/presets/<id>` | DELETE | Delete preset |

Presets are stored in the `ClassificationPreset` table, scoped to `current_user.id`. Rules are stored as the same JSON array format used in classification requests.

---

### 7.3 File Merge Module

All routes require `@tool_required('file_merge')`.

#### `GET /union`

Renders `union.html`.

#### `POST /union/detect`

Same as `/clasificacion/detect` but for the merge tool. Field name: `file`.

#### `POST /union/merge`

Merges uploaded files.

**Mode `default` (form field `mode=default`):**  
Fields: `files[]` (2+ files), `encodings` (JSON array), `separators` (JSON array). Encoding/separator arrays are positionally matched to the files array. `null` values trigger auto-detection for that file.

**Mode `advanced` (form field `mode=advanced`):**  
Fields: `file_a`, `file_b`, `mapping` (JSON dict `{col_b: col_a}`), `encoding_a`, `sep_a`, `encoding_b`, `sep_b`.

**Response:**
```json
{
  "success": true,
  "download_url": "/union/download/<file_id>",
  "total_rows": 8500,
  "total_columns": 12,
  "files_merged": 3
}
```

#### `GET /union/download/<file_id>`

Streams the merged file as an attachment. File must exist as `scratch/merged_<file_id>.csv`.

---

### 7.4 CSV Analysis Module

Requires `@tool_required('csv_analysis')`.

#### `GET/POST /analisis-csv`

- `GET`: renders `analisis_csv.html`.
- `POST`: accepts `csv_file`, `encoding` (default `utf-8`), `separator` (default `,`). Saves file to `scratch/`, runs `csv_analysis.analyze_csv()`, generates a summary CSV for download. Returns full analysis JSON.

---

### 7.5 Download & Utility Routes

| Route | Auth | Description |
|---|---|---|
| `GET /download/<filename>` | login_required | Downloads a file from `scratch/`. Path-traversal protected. |
| `GET /download_classified/<file_id>/<original_name>` | login_required | Downloads `scratch/classified_<file_id>.csv` with `original_name` as the download filename. |
| `GET /download_csv_summary/<file_id>` | login_required | Downloads `scratch/summary_<file_id>.csv`. |
| `GET /error/archivo-invalido` | public | Renders error page for invalid file uploads. |

Cleanup: `clean_scratch_folder()` removes files older than 1 hour and runs as an `@after_this_request` hook on downloads.

---

## 8. Frontend Templates

All templates extend `base.html` (or `base_auth.html` for login/register).

### `base.html`

- Sidebar navigation with links to all tools.
- `has_tool_access(key)` template function controls sidebar link visibility.
- Dark mode CSS custom properties.
- Font Awesome and Inter font loaded via CDN.

### `clasificacion.html`

**JS state variables:**
- `categories` — array of `{ id, name, tematicas: [{ id, name, keywords }] }`. Drives the rule builder UI.
- `detectedFmt` — object returned by `/clasificacion/detect`. Stored after file upload.

**Key JS functions:**

| Function | Description |
|---|---|
| `onFileSelected(file)` | Sends file to `/detect`, calls `populateMappingCard()` |
| `populateMappingCard(data)` | Fills column selects + renders preview table |
| `redetectFile()` | Re-runs detect (for after manual encoding/sep change) |
| `processClassification()` | Full classification flow: upload → upload_body → chunk loop → finalize |
| `renderRules()` | Re-renders the rule builder DOM from `categories` state |
| `addCategory() / addTematica()` | Mutate `categories` + re-render |
| `savePreset() / loadPreset(id)` | Persist/restore categories via preset API |
| `showResults(result)` | Renders Chart.js doughnut + category tree + download link |
| `renderChart(stats, defaultVal)` | Builds Chart.js doughnut from stats object |
| `mergeStats(target, partial)` | Accumulates partial chunk stats during processing |
| `setProgress(done, total)` | Updates progress bar UI |
| `postJson(url, payload)` | Fetch wrapper for JSON POST |

**Encoding/Separator override panel (inside mapping card):**
User can expand "Opciones avanzadas de formato" to select encoding (`utf-8`/`utf-16`/`latin-1`/`cp1252`) and separator (`,`/`;`/`\t`/`|`). Overrides are sent with the `processClassification()` upload call. "Volver a detectar" re-runs `/detect` for a fresh column preview.

### `union.html`

Two modes with separate UI panels. Advanced mode includes a visual column-mapper where the user drags or selects which column from File B maps to which column from File A.

### `analisis_csv.html`

Displays analysis results in tab panels: Overview, Missing Values, Numeric Stats, Categorical Stats, Correlation Matrix. Charts rendered via Chart.js.

---

## 9. Static Assets & Design System

File: `static/css/style.css`

Uses CSS custom properties for theming:

```css
--c-primary          /* Brand color (#fadf25) */
--c-bg               /* Page background */
--c-white            /* Card background */
--c-border           /* Default border */
--c-text-primary     /* Main text */
--c-text-secondary   /* Muted text */
--c-success          /* Green */
--c-danger           /* Red */
--c-warning          /* Orange/yellow */
--c-primary-light    /* Light brand tint */
--c-chart-text       /* Chart.js label color */
```

Component classes: `.card`, `.card-title`, `.form-input`, `.form-label`, `.form-group`, `.form-row`, `.form-hint`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-add`, `.btn-remove`, `.upload-zone`, `.rule-category`, `.tematica-group`, `.badge`, `.flash-msg`, `.animate-fade`.

---

## 10. Configuration & Environment

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | ✅ | Flask session signing key. App raises `RuntimeError` at startup if missing. |
| `GROQ_API_KEY` | ⚠️ | Groq API key. App starts without it but AI analysis returns "No disponible". |
| `DATABASE_URL` | ⚠️ | Postgres/Neon connection string. Recommended in production; app falls back to SQLite when missing. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_USERNAME` | ⚠️ | Default admin bootstrap credentials at startup (used only if no admin exists). |
| `ENABLE_PAGE_VIEW_LOGS` | ⚠️ | Enables low-value page-view logging. Defaults to off in production to save storage. |
| `ACTIVITY_LOG_RETENTION_DAYS` / `ACTIVITY_LOG_MAX_ROWS` | ⚠️ | Log pruning controls to keep DB size bounded. |
| `REPORT_METADATA_RETENTION_DAYS` | ⚠️ | Deletes old report metadata rows beyond retention window. |

Other configuration in `app.py`:

```python
app.config['UPLOAD_FOLDER'] = 'scratch'
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200 MB
```

If `DATABASE_URL` is set, SQLAlchemy connects to that DB (e.g., Neon/Postgres). Otherwise it defaults to local SQLite at `instance/users.db`.

---

## 11. Security

| Measure | Implementation |
|---|---|
| Session signing | `SECRET_KEY` required at startup |
| Password storage | Werkzeug PBKDF2-SHA256 hashing |
| Path traversal | All download routes use `secure_filename()` + `os.path.abspath()` prefix check |
| Tool access | `@tool_required()` decorator checks per-user tool permissions on every route |
| File size limit | 200 MB via `MAX_CONTENT_LENGTH` |
| Rate limiting | Flask-Limiter applied to sensitive routes |
| Session ID validation | `secure_filename(session_id)` check — rejects any ID containing path chars |

---

## 12. Test Suite

Files in `tests/`. Run with `pytest tests/ -v`.

| File | Coverage |
|---|---|
| `test_auth.py` | Login, registration, session management |
| `test_logic.py` | Classification rule engine edge cases |
| `test_calculation.py` | Data cleaning, KPI calculation, chart data formatting |
| `test_csv_analysis.py` | CSV analysis functions: missing values, stats, correlations |
| `test_ai.py` | Groq prompt construction and JSON extraction |
| `test_ppt.py` | PPTX generation: placeholder finding, chart insertion |
| `test_environment.py` | Env var presence, DB connectivity, folder permissions |

**Key test scenarios:**
- **Encoding robustness**: Upload Latin-1 and UTF-16 files to classification — expect correct character rendering.
- **Match priority**: A row matching both Pass 1 and Pass 2 rules must be assigned by Pass 1 only.
- **Excel upload**: `.xlsx` file must produce a valid column list and classification result.
- **Empty chunk**: Classification chunk with zero valid rows must return `{ success: true, rows_in_chunk: 0 }`.
- **Preset round-trip**: Save + load preset, verify rules are identical.
- **Merge column mismatch**: Advanced merge with no valid column matches must return `ValueError`.
