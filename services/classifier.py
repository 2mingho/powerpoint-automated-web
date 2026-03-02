import io
import pandas as pd
from services.calculation import clean_dataframe


# ─────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────

def _detect_sep(header: str) -> str:
    """Guess the separator from the header line by counting candidate chars."""
    counts = {'\t': header.count('\t'), ',': header.count(','),
              ';': header.count(';'), '|': header.count('|')}
    return max(counts, key=counts.get)


def _load_chunk_df(rows_text: str, header_text: str, text_col: str, keywords_col: str = '') -> pd.DataFrame:
    """
    Parse a chunk of CSV/TSV rows from memory, auto-detecting the separator.
    Renames user-chosen columns to canonical names and applies basic cleaning.
    """
    sep = _detect_sep(header_text)
    raw = header_text + rows_text
    buf = io.StringIO(raw)
    try:
        df = pd.read_csv(buf, sep=sep, on_bad_lines='skip')
    except Exception:
        buf = io.StringIO(raw)
        df = pd.read_csv(buf, sep=sep, on_bad_lines='skip', engine='python')

    if df.empty:
        return df

    # Rename user-mapped columns to canonical names
    rename = {}
    if text_col and text_col in df.columns and text_col != 'Hit Sentence':
        rename[text_col] = 'Hit Sentence'
    if keywords_col and keywords_col in df.columns and keywords_col != 'Keywords':
        rename[keywords_col] = 'Keywords'
    if rename:
        df = df.rename(columns=rename)

    # Ensure Hit Sentence exists
    if 'Hit Sentence' not in df.columns:
        df['Hit Sentence'] = ''

    # Fill empty Hit Sentence from Headline if available (mirrors clean_dataframe logic)
    if 'Headline' in df.columns:
        mask_empty = df['Hit Sentence'].isna() | (df['Hit Sentence'].astype(str).str.strip() == '')
        df.loc[mask_empty, 'Hit Sentence'] = df.loc[mask_empty, 'Headline'].fillna('')

    return df


def _apply_rules(df: pd.DataFrame, text_col: str, rules_config: list, default_val: str) -> None:
    """Apply keyword classification rules to *text_col* in-place."""
    col_lower = text_col + '_lower'
    df[col_lower] = df[text_col].fillna('').astype(str).str.lower()
    for category_rule in rules_config:
        category_name = str(category_rule.get('category', 'Otros'))
        for tematica_rule in category_rule.get('tematicas', []):
            tematica_name = str(tematica_rule.get('name', 'General'))
            keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
            if not keywords:
                continue
            mask = df[col_lower].apply(lambda s: any(k in s for k in keywords))
            df.loc[mask & (df['Tematica'] == default_val), 'Tematica'] = tematica_name
            df.loc[mask & (df['Categoria'] == default_val), 'Categoria'] = category_name
    df.drop(columns=[col_lower], inplace=True)


# ─────────────────────────────────────────────────────────────
# Chunked variant (in-memory, no file I/O)
# ─────────────────────────────────────────────────────────────

def classify_chunk(rows_text: str, header_text: str, rules_config: list,
                   default_val: str = 'Sin Clasificar', use_keywords: bool = False,
                   text_col: str = 'Hit Sentence', keywords_col: str = 'Keywords') -> pd.DataFrame:
    """
    Classify a batch of CSV rows supplied as plain text (no disk I/O).
    Separator is auto-detected from the header line.

    Parameters
    ----------
    rows_text    : str  — CSV data rows (WITHOUT the header line)
    header_text  : str  — Original header line (WITH trailing newline)
    rules_config : list — [{category, tematicas: [{name, keywords}]}]
    default_val  : str  — Label for unmatched rows
    use_keywords : bool — Run the keywords-column fallback pass
    text_col     : str  — Column to classify (user-mapped, will be renamed to 'Hit Sentence')
    keywords_col : str  — Optional keywords column (user-mapped)
    """
    df = _load_chunk_df(rows_text, header_text, text_col, keywords_col)
    if df is None or df.empty:
        return df

    if 'Tematica' not in df.columns:
        df['Tematica'] = default_val
    if 'Categoria' not in df.columns:
        df['Categoria'] = default_val

    # Pass 1 — primary text column
    if 'Hit Sentence' in df.columns:
        _apply_rules(df, 'Hit Sentence', rules_config, default_val)

    # Pass 2 — keywords fallback (optional)
    if use_keywords:
        if 'Keywords' not in df.columns and 'Keyword' in df.columns:
            df.rename(columns={'Keyword': 'Keywords'}, inplace=True)
        if 'Keywords' not in df.columns:
            df['Keywords'] = ''
        _apply_rules(df, 'Keywords', rules_config, default_val)

    return df


# ─────────────────────────────────────────────────────────────
# Full-file variant (original – used by report module)
# ─────────────────────────────────────────────────────────────

def classify_mentions(file_path: str, rules_config: list,
                      default_val: str = 'Sin Clasificar', use_keywords: bool = False) -> pd.DataFrame:
    """
    Classifies mentions based on a hierarchical rule configuration.
    Loads the file via clean_dataframe() (same as the report module).

    rules_config format:
    [
        {
            "category": "Economy",
            "tematicas": [
                {"name": "Inflation", "keywords": ["prices", "cost of living"]},
            ]
        },
        ...
    ]
    """
    df = clean_dataframe(file_path)

    if 'Tematica' not in df.columns:
        df['Tematica'] = default_val
    if 'Categoria' not in df.columns:
        df['Categoria'] = default_val

    # Pass 1 — Hit Sentence
    df['Hit Sentence Lower'] = df['Hit Sentence'].fillna('').astype(str).str.lower()
    for category_rule in rules_config:
        category_name = str(category_rule.get('category', 'Otros'))
        for tematica_rule in category_rule.get('tematicas', []):
            tematica_name = str(tematica_rule.get('name', 'General'))
            keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
            if not keywords:
                continue
            mask = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
            df.loc[mask & (df['Tematica'] == default_val), 'Tematica'] = tematica_name
            df.loc[mask & (df['Categoria'] == default_val), 'Categoria'] = category_name

    # Pass 2 — Keywords fallback (optional)
    if use_keywords:
        if 'Keywords' not in df.columns:
            if 'Keyword' in df.columns:
                df = df.rename(columns={'Keyword': 'Keywords'})
            else:
                df['Keywords'] = ''

        df['Keywords Lower'] = df['Keywords'].fillna('').astype(str).str.lower()
        for category_rule in rules_config:
            category_name = str(category_rule.get('category', 'Otros'))
            for tematica_rule in category_rule.get('tematicas', []):
                tematica_name = str(tematica_rule.get('name', 'General'))
                keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
                if not keywords:
                    continue
                mask = df['Keywords Lower'].apply(lambda s: any(k in s for k in keywords))
                df.loc[mask & (df['Tematica'] == default_val), 'Tematica'] = tematica_name
                df.loc[mask & (df['Categoria'] == default_val), 'Categoria'] = category_name

        df.drop(columns=['Keywords Lower'], inplace=True, errors='ignore')

    df.drop(columns=['Hit Sentence Lower'], inplace=True, errors='ignore')
    return df
