"""
services/file_merger.py
-----------------------
Backend logic for the Unir Archivos (File Merge) feature.
Supports CSV (.csv, .txt) and Excel (.xlsx, .xls) with configurable encoding/separator.
"""
import io
import pandas as pd
import chardet


# ─────────────────────────────────────────────────────────────
# File Reading
# ─────────────────────────────────────────────────────────────

def read_file(raw_bytes: bytes, filename: str,
              encoding: str | None = None,
              sep: str | None = None) -> pd.DataFrame:
    """
    Read a tabular file from raw bytes.
    
    If encoding/sep are None, auto-detection is attempted.
    Returns a DataFrame or raises ValueError on failure.
    """
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''

    # --- Excel ---
    if ext in ('xlsx', 'xls'):
        return _read_excel(raw_bytes, ext)

    # --- CSV / TXT ---
    return _read_csv(raw_bytes, encoding, sep)


def _read_excel(raw_bytes: bytes, ext: str) -> pd.DataFrame:
    """Read Excel file."""
    engine = 'openpyxl' if ext == 'xlsx' else 'xlrd'
    try:
        buf = io.BytesIO(raw_bytes)
        df = pd.read_excel(buf, engine=engine)
        if df.empty:
            raise ValueError("El archivo Excel esta vacio.")
        return df
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"No se pudo leer el archivo Excel: {e}")


def _read_csv(raw_bytes: bytes, encoding: str | None, sep: str | None) -> pd.DataFrame:
    """Read CSV/TXT file with optional auto-detection."""
    encodings = [encoding] if encoding else _detect_encodings(raw_bytes)
    separators = [sep] if sep else ['\t', ',', ';', '|']

    for enc in encodings:
        for s in separators:
            try:
                buf = io.BytesIO(raw_bytes)
                df = pd.read_csv(buf, encoding=enc, sep=s, on_bad_lines='skip')
                if df.shape[1] > 1 and len(df) > 0:
                    return df
            except Exception:
                continue

    raise ValueError("No se pudo leer el archivo CSV. Verifica la codificacion y el separador.")


def _detect_encodings(raw_bytes: bytes) -> list[str]:
    """Return ordered list of candidate encodings."""
    candidates = ['utf-16', 'utf-8', 'latin-1', 'cp1252']
    hint = chardet.detect(raw_bytes[:8192]).get('encoding', '') or ''
    if hint and hint.lower().replace('-', '') not in [e.lower().replace('-', '') for e in candidates]:
        candidates.insert(0, hint)
    return candidates


# ─────────────────────────────────────────────────────────────
# Merge Operations
# ─────────────────────────────────────────────────────────────

def merge_default(dataframes: list[pd.DataFrame]) -> pd.DataFrame:
    """
    Concatenate DataFrames that share the same column structure.
    Columns are aligned by name; missing columns are filled with NaN.
    
    Raises ValueError if fewer than 2 DataFrames are provided.
    """
    if len(dataframes) < 2:
        raise ValueError("Se necesitan al menos 2 archivos para unir.")

    # Normalize column names (strip whitespace)
    for i, df in enumerate(dataframes):
        dataframes[i].columns = [str(c).strip() for c in df.columns]

    # Use pd.concat with alignment — handles mismatched columns gracefully
    result = pd.concat(dataframes, ignore_index=True, sort=False)
    return result


def merge_advanced(df_a: pd.DataFrame, df_b: pd.DataFrame,
                   mapping: dict[str, str]) -> pd.DataFrame:
    """
    Merge two DataFrames with different structures using a column mapping.
    
    Parameters
    ----------
    df_a : Primary DataFrame (defines the output structure)
    df_b : Secondary DataFrame (columns will be renamed per mapping)
    mapping : dict where key = df_b column name, value = df_a column name
              Only mapped columns from df_b are kept.
    
    Returns
    -------
    Concatenated DataFrame with df_a's column structure.
    """
    if not mapping:
        raise ValueError("El mapeo de columnas esta vacio.")

    # Normalize column names
    df_a.columns = [str(c).strip() for c in df_a.columns]
    df_b.columns = [str(c).strip() for c in df_b.columns]

    # Select only mapped columns from df_b and rename them
    b_cols = {k: v for k, v in mapping.items() if k in df_b.columns and v in df_a.columns}
    if not b_cols:
        raise ValueError("Ninguna columna del mapeo coincide con los archivos.")

    df_b_mapped = df_b[list(b_cols.keys())].rename(columns=b_cols)

    # Concatenate: df_a structure + df_b mapped data
    result = pd.concat([df_a, df_b_mapped], ignore_index=True, sort=False)
    return result


def save_merged(df: pd.DataFrame, output_path: str,
                encoding: str = 'utf-16', sep: str = '\t') -> None:
    """Save merged DataFrame to CSV."""
    df.to_csv(output_path, sep=sep, encoding=encoding, index=False)
