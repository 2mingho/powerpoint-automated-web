# Technical Documentation: Social Listening & Classification System

This document provides a technical deep-dive into the internal logic, architecture, and functionalities of the PowerPoint Automated Web tool, specifically focusing on the Data Classification and Report Generation engines.

---

## 🏗️ System Architecture

The application follows a standard Flask architecture with specialized modules for data processing and PPTX generation:

- **`app.py`**: Routing, request handling, and core workflow orchestration.
- **`classifier.py`**: Hierarchical rule-based classification engine.
- **`calculation.py`**: Data cleaning, KPI calculation, and chart data formatting.
- **`ppt_engine.py`**: Low-level PowerPoint manipulation using `python-pptx`.
- **`groq_analysis.py`**: Integration with Llama3 (via Groq) for qualitative insights.

---

## 🔍 Classification Engine (`classifier.py`)

The classification engine uses a **Two-Pass hierarchical matching system** to categorize raw mentions into **Categories** and **Temáticas**.

### `classify_mentions(file_path, rules_config, default_val, use_keywords)`

This is the main entry point for classification.

#### 1. Pre-processing
- Calls `calculation.clean_dataframe()` to handle UTF-16 encoding, remove irrelevant columns, and fill missing `Hit Sentence` values from the `Headline`.
- Normalizes data (lower-casing) for case-insensitive matching.

#### 2. Pass 1: Primary Search (`Hit Sentence`)
- Iterates through the `rules_config` provided by the UI.
- Checks if any defined keywords exist within the `Hit Sentence` column.
- **Priority**: The first rule that matches a row assigns the Category/Temática. Once a row is classified, it's skipped for the rest of Pass 1.

#### 3. Pass 2: Secondary Search (`Keywords` Column)
- *Optional (Conditional on `use_keywords=True`)*.
- Runs only for rows that remain with the `default_val` (unclassified).
- Searches the `Keywords` column (often containing metadata or tags) using the same rule set.
- This pass is designed to catch mentions where the actual post text is missing but metadata is available.

---

## 🔌 API Endpoints

### `POST /clasificacion`
Handles the classification upload and rule processing.

- **Request Data (Multipart/Form-Data)**:
    - `csv_file`: The raw social listening export (UTF-16).
    - `rules`: JSON string representing the hierarchical rules.
    - `default_val`: String to use for unclassified items (e.g., "Sin clasificar").
    - `use_keywords`: Boolean flag to enable the second pass.
- **Response (JSON)**:
    - `success`: Boolean.
    - `download_url`: Path to the processed CSV.
    - `stats`: Nested dictionary with distribution counts for the frontend tree.
    - `insights`: Predictive summary (top category and count).

---

## 📊 Data Processing (`calculation.py`)

### `clean_dataframe(file_path)`
Crucial function that ensures data consistency across the app.
- **Platform Mapping**: Automatically classifies sources (Twitter, Facebook, etc.) into "Redes Sociales" or "Prensa Digital" based on a predefined dictionary.
- **Reach Normalization**: Converts reach strings to numeric values for KPI calculation.

---

## 🧪 Diagnostic & Testing Strategy

To ensure system stability, we recommend implementing the following tests:

### 1. Functional Logic Tests (Pytest)
Validate that the `classifier.py` logic behaves as expected with edge cases:
- **Test Case**: "Match Priority" - Ensure `Hit Sentence` always takes precedence over `Keywords` if both match different rules.
- **Test Case**: "Encoding Robustness" - Upload UTF-8 and UTF-16 files to ensure `clean_dataframe` handles both.

### 2. Integration Tests
Test the `/clasificacion` endpoint using `app.test_client()`:
- Verify that invalid JSON in the `rules` field returns a 400ish error instead of a crash.
- Ensure the `scratch/` folder permissions allow file creation and cleanup.

### 3. Automatic Diagnostic Script
Create a `check_system.py` that verifies:
- `.env` existence and `GROQ_API_KEY` validity.
- Folder permissions for `scratch/`, `powerpoints/`, and `uploads/`.
- Database connectivity (`User` model accessibility).

---

## 🛠️ Frontend Logic (`clasificacion.html`)

- **Rule Builder**: Uses a dynamic state array (`categories`) and re-renders the DOM on every change.
- **Visualization**: Integrates `Chart.js` via CDN to render a doughnut chart from the `stats` object returned by the server.
- **Tree Rendering**: Recursively iterates through the `stats` JSON to build a nested folder-like view.
