"""
services/file_loader.py
-----------------------
Auto-detects encoding, separator, and file type for uploaded tabular files.
Supports: .csv, .txt (any encoding/separator), .xlsx, .xls
"""
import io
import chardet
import pandas as pd


# Candidate combinations tried in order
_ENCODINGS  = ['utf-16', 'utf-8', 'latin-1', 'cp1252']
_SEPARATORS = ['\t', ',', ';', '|']


def _try_read_csv(raw_bytes: bytes, encoding: str, sep: str, nrows: int = 6) -> pd.DataFrame | None:
    """Try parsing bytes as CSV with given encoding+separator. Returns None on failure."""
    try:
        buf = io.BytesIO(raw_bytes)
        df = pd.read_csv(buf, encoding=encoding, sep=sep, nrows=nrows, on_bad_lines='skip')
        if df.shape[1] > 1 and len(df) > 0:
            return df
    except Exception:
        pass
    return None


def _try_read_excel(raw_bytes: bytes, nrows: int = 6) -> tuple[pd.DataFrame | None, str]:
    """Try parsing bytes as Excel. Returns (df, sheet_name) or (None, '')."""
    try:
        buf = io.BytesIO(raw_bytes)
        df = pd.read_excel(buf, nrows=nrows, engine='openpyxl')
        if df.shape[1] > 1 and len(df) > 0:
            return df, 'xlsx'
    except Exception:
        pass
    try:
        buf = io.BytesIO(raw_bytes)
        df = pd.read_excel(buf, nrows=nrows, engine='xlrd')
        if df.shape[1] > 1 and len(df) > 0:
            return df, 'xls'
    except Exception:
        pass
    return None, ''


def detect_format(raw_bytes: bytes, filename: str = '') -> dict:
    """
    Auto-detect the format of an uploaded tabular file.

    Returns
    -------
    dict with keys:
        file_type : 'csv' | 'xlsx' | 'xls'
        encoding  : str | None
        sep       : str | None
        columns   : list[str]
        preview   : list[dict]   (first 5 rows as records)
        error     : str | None
    """
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''

    # --- Excel ---
    if ext in ('xlsx', 'xls'):
        df, ftype = _try_read_excel(raw_bytes)
        if df is not None:
            return {
                'file_type': ftype,
                'encoding': None,
                'sep': None,
                'columns': [str(c) for c in df.columns.tolist()],
                'preview': df.head(5).fillna('').astype(str).to_dict(orient='records'),
                'error': None,
            }
        return {'error': 'No se pudo leer el archivo Excel. Verifica que no esté corrupto.'}

    # --- CSV / TXT ---
    # Quick chardet hint for smarter ordering
    hint = chardet.detect(raw_bytes[:8192]).get('encoding', '') or ''
    enc_order = _ENCODINGS[:]
    if hint and hint.lower().replace('-', '') not in [e.lower().replace('-', '') for e in enc_order]:
        enc_order.insert(0, hint)

    for enc in enc_order:
        for sep in _SEPARATORS:
            df = _try_read_csv(raw_bytes, enc, sep)
            if df is not None:
                return {
                    'file_type': 'csv',
                    'encoding': enc,
                    'sep': sep,
                    'columns': [str(c) for c in df.columns.tolist()],
                    'preview': df.head(5).fillna('').astype(str).to_dict(orient='records'),
                    'error': None,
                }

    return {'error': 'No se pudo detectar el formato del archivo. Prueba guardando como CSV UTF-8.'}


def read_full_as_tsv(raw_bytes: bytes, fmt: dict) -> tuple[str, str]:
    """
    Read the entire file and return (header_line, body_text) as UTF-8 TSV strings
    so the existing classify_chunk() pipeline can process them unchanged.

    Returns ('', '') on error.
    """
    try:
        if fmt['file_type'] in ('xlsx', 'xls'):
            buf = io.BytesIO(raw_bytes)
            engine = 'openpyxl' if fmt['file_type'] == 'xlsx' else 'xlrd'
            df = pd.read_excel(buf, engine=engine)
        else:
            buf = io.BytesIO(raw_bytes)
            df = pd.read_csv(buf, encoding=fmt['encoding'], sep=fmt['sep'], on_bad_lines='skip')

        out = io.StringIO()
        df.to_csv(out, sep='\t', index=False, encoding='utf-8')
        tsv = out.getvalue()
        lines = tsv.split('\n')
        header = lines[0] + '\n'
        body   = '\n'.join(lines[1:])
        return header, body
    except Exception as e:
        return '', ''
