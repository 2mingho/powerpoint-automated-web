# 📊 PowerPoint Automated Web

A professional web application for generating automated, data-driven reports from CSV data. This tool provides visual analysis, social listening insights powered by AI (Groq/Llama3), and generates professional PowerPoint presentations ready for download.

---

## 🚀 Key Features

*   **User Authentication**: Secure login and registration system.
*   **Data Visualization**: Automatic generation of sentiment pie charts and conversation evolution line graphs.
*   **Hierarchical Data Classification**: Advanced engine to categorize mentions based on a Two-Pass (Hit Sentence & Keywords) rule system.
*   **AI Social Listening**: Advanced analysis of social media mentions using **Groq API (Llama3)** to identify themes and sentiment.
*   **PowerPoint Engine**: Automated generation of native `.pptx` files with dynamic tables, charts, and text replacement.
*   **Automated Diagnostic System**: One-command health check for environment, auth, logic, calculation, and AI modules with PDF report export.
*   **Report Management**: Personal dashboard to browse and download previous reports.
*   **Interactive Insights**: Visual distribution trees and Chart.js dashboards for classified data.
*   **Clean Export**: Generates a ZIP file containing the presentation and supporting data.

---

## 🛠️ Tech Stack

*   **Backend**: Python, Flask, Flask-Login, Flask-SQLAlchemy (SQLite)
*   **AI**: Groq API (Llama3-70b)
*   **Data & Charts**: Pandas, Matplotlib
*   **PPTX Generation**: Python-pptx
*   **Styling**: Vanilla CSS (Responsive Design)

---

## ⚙️ Prerequisites

*   Python 3.10 or higher
*   Groq API Key (for AI analysis)
*   CSV files encoded in **UTF-16** (standard for many social listening tools)

---

## 🚀 Getting Started

### 1. Clone & Setup
1. Clone the repository or download the source code.
2. Create a `.env` file in the root directory:
   ```env
   GROQ_API_KEY=your_api_key_here
   SECRET_KEY=your_flask_secret_key
   ```

### 2. Automatic Installation (Windows)
Run the provided batch script to create a virtual environment, install dependencies, and launch the app:
```bash
setup_env.bat
```

### 3. Manual Installation (Any OS)
If you prefer manual setup:
```bash
# Create and activate venv
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```
Access the application at `http://localhost:5000/`.

---

## 🧩 Project Structure

```text
POWERPOINT-AUTOMATED-WEB/  
├── app.py                   # Main Flask application and routing
├── auth.py                  # Authentication logic (Login/Register/Logout)
├── calculation.py           # Data processing and chart generation
├── classifier.py            # Hierarchical data classification engine
├── groq_analysis.py         # AI analysis integration via Groq
├── ppt_engine.py            # PowerPoint generation engine
├── models.py                # Database models (User, Reports)
├── extensions.py            # Shared extensions (DB, LoginManager)
├── documentation.md         # Technical deep-dive and internal logic
├── requirements.txt         # Project dependencies
├── run_diagnostic.py        # System health-check orchestrator
├── setup_env.bat            # Automated setup script
├── users.db                 # SQLite database
│  
├── tests/                   # Automated diagnostic test modules
├── powerpoints/             # Slide templates and templates storage
│   └── Reporte_plantilla.pptx  
├── static/                  
│   ├── css/style.css        # Global styles
│   └── img/                 # Static assets
├── templates/               # Jinja2 HTML templates
└── scratch/                 # Temporary data (cleared after generation)
```

---

## 🛠️ Maintenance & Diagnostics

Keep the system healthy using the built-in diagnostic suite:

1. **Run Diagnostics**: Execute the following command in the terminal:
   ```bash
   python run_diagnostic.py
   ```
2. **Review Report**: Open the generated `diagnostic_report.html` in any browser.
3. **Export**: Use the **"Save as PDF"** button within the report to share the results.

---

## 📌 Important Notes

*   **CSV Encoding**: Ensure your input CSVs use **UTF-16** encoding to avoid parsing errors.
*   **Two-Pass Classification**: Enable "Doble Pasada" in settings to use the `Keywords` column as a fallback.
*   **Security**: Always check your `.env` file if AI analysis fails.

