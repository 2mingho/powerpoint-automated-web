# Data Intel — Social Listening & Reporting Platform

A multi-tool web application for media analysts and social listening teams. Upload CSV or Excel exports from monitoring tools and generate automated PowerPoint reports, classify mentions by topic, analyze file structure, and merge datasets — all through a clean browser interface.

---

## Features

| Tool | Description |
|---|---|
| **Report Generator** | Produces a full `.pptx` + CSV ZIP from a social listening export. Includes line charts, pie charts, influencer tables, and an AI-powered analysis summary. |
| **Data Classification** | Classifies mentions by user-defined categories and topics using keyword rules. Supports chunked processing, column mapping, encoding/separator overrides, and saveable presets. |
| **File Merge** | Concatenates 2+ CSV or Excel files with the same structure (default mode), or maps columns from two differently structured files (advanced mode). |
| **CSV Analysis** | Exploratory analysis of any CSV: row/column counts, missing-value audit, numeric statistics, categorical distributions, and a Pearson correlation matrix. |

---

## Tech Stack

| Layer | Libraries |
|---|---|
| Backend | Python 3.10+, Flask, Flask-Login, Flask-SQLAlchemy, Flask-Limiter |
| Data | Pandas, NumPy, chardet, openpyxl, xlrd |
| AI | Groq API (Llama3-70b-8192) |
| PPTX | python-pptx, Matplotlib, WordCloud |
| Frontend | Vanilla HTML/CSS/JS, Chart.js (CDN), Font Awesome (CDN) |
| Database | SQLite (via SQLAlchemy) |
| Deployment | Gunicorn (production), Flask dev server (local) |

---

## Prerequisites

- Python 3.10 or higher
- A [Groq API key](https://console.groq.com/) (free tier available)
- Input files: **CSV** (any encoding/separator auto-detected) or **Excel** (`.xlsx` / `.xls`)

---

## Getting Started

### 1. Environment Variables

Create a `.env` file in the project root:

```env
SECRET_KEY=your_random_flask_secret_key
GROQ_API_KEY=your_groq_api_key_here
```

### 2. Quick Setup (Windows)

```bat
setup_env.bat
```

This scripts creates a virtual environment, installs all dependencies, and launches the app.

### 3. Manual Setup (Any OS)

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000` in your browser. Register a first user — the first registration auto-assigns the `admin` role.

---

## Project Structure

```
powerpoint-automated-web/
├── app.py                     # All Flask routes and workflow orchestration
├── models.py                  # SQLAlchemy models: User, Report, ActivityLog, ClassificationPreset
├── extensions.py              # Shared db + login_manager instances
├── init_db.py                 # DB schema initializer (run once or on deploy)
├── requirements.txt
├── setup_env.bat / setup_env.sh
│
├── services/                  # Business logic (no Flask dependencies)
│   ├── classifier.py          # Keyword-based chunked classification engine
│   ├── calculation.py         # Data cleaning, KPI calc, chart-data formatting
│   ├── csv_analysis.py        # Generic CSV exploratory analysis
│   ├── file_loader.py         # Auto-detect encoding/sep; read CSV/Excel → TSV
│   ├── file_merger.py         # Merge multiple CSV/Excel files
│   └── groq_analysis.py       # Groq/Llama3 API integration
│
├── pptx_builder/              # PowerPoint generation engine
│   └── (native_charts, ppt_engine, etc.)
│
├── blueprints/
│   ├── auth.py                # Login / Register / Logout routes
│   └── admin.py               # Admin dashboard, user management, activity log
│
├── templates/                 # Jinja2 HTML templates
│   ├── base.html              # Shared layout with sidebar navigation
│   ├── index.html             # Report generator
│   ├── clasificacion.html     # Data classification tool
│   ├── union.html             # File merge tool
│   ├── analisis_csv.html      # CSV analysis tool
│   └── ...
│
├── static/
│   ├── css/style.css          # Global design system (CSS custom properties)
│   └── img/
│
├── powerpoints/               # PPTX template files
├── scratch/                   # Temporary upload/output files (auto-cleaned)
├── instance/users.db          # SQLite database
└── tests/                     # Pytest test suite
```

---

## User Roles & Access Control

| Role | Access |
|---|---|
| `admin` | Full access to all tools and the admin dashboard |
| `DI` (default) | Access controlled per-tool via admin panel |
| `MW` | Access controlled per-tool via admin panel |

Admins can enable/disable individual tools (`reports`, `classification`, `file_merge`, `csv_analysis`) per user.

---

## File Compatibility

The classification, merge, and analysis tools accept:
- **CSV / TXT**: Any encoding (UTF-8, UTF-16, Latin-1, CP1252 auto-detected via `chardet`). Any separator (`,` `;` `\t` `|` auto-detected).
- **Excel**: `.xlsx` (openpyxl) and `.xls` (xlrd).

If auto-detection fails, encoding and separator can be manually overridden in the UI.

---

## Maintenance & Diagnostics

Run the built-in test suite:

```bash
pytest tests/
```

Check environment, auth, logic, and AI modules:

```bash
python -m pytest tests/ -v
```

Temporary files in `scratch/` are automatically purged when they are older than 1 hour.

---

## Important Notes

- **SECRET_KEY** must be set before starting the app — it will raise a `RuntimeError` at startup if missing.
- **GROQ_API_KEY** is optional but AI report analysis will display "No disponible" without it.
- The report generator expects social listening CSV exports in **UTF-16 tab-delimited format** (standard Meltwater/similar export). Other tools accept any format.
- The `scratch/` folder must be writable by the process user.
