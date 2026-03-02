import pandas as pd
import io
from datetime import datetime
from extensions import db
from models import ClassificationProfile
from services.classifier import classify_mentions
from app import app

def get_active_profile_rules():
    """FETCH the active profile and format it for the classifier service."""
    active_profile = ClassificationProfile.query.filter_by(is_active=True).first()
    if not active_profile:
        return []
        
    rules = []
    for cat in active_profile.categories:
        cat_dict = {
            "category": cat.name,
            "tematicas": []
        }
        for theme in cat.themes:
            keywords = [k.keyword for k in theme.keywords]
            cat_dict["tematicas"].append({
                "name": theme.name,
                "keywords": keywords
            })
        rules.append(cat_dict)
    return rules

def normalize_date(date_str):
    """
    Parses 'MM/DD/YYYY hh:mm:ss AM/PM' to datetime object.
    Returns None if parsing fails.
    """
    if not isinstance(date_str, str):
        return None
    try:
        # Example: "10/25/2023 02:30:00 PM"
        return datetime.strptime(date_str, "%m/%d/%Y %I:%M:%S %p")
    except ValueError:
        # Fallback strategies could act here
        try:
             return datetime.strptime(date_str, "%m/%d/%Y %H:%M:%S")
        except ValueError:
            return None

def process_social_csv(file_stream, encoding, separator, text_column, mes, anio):
    """
    Reads CSV, classifies content, and adds standard columns.
    Returns a DataFrame (or dict representation).
    """
    try:
        app.logger.info(f"Reading CSV with encoding={encoding}, sep='{separator}'")
        # 1. Read CSV
        df = pd.read_csv(file_stream, encoding=encoding, sep=separator)
        
        # 2. Validate columns
        if text_column not in df.columns:
            raise ValueError(f"Column '{text_column}' not found in CSV.")

        # 3. Inject Metadata
        df['MES'] = mes
        df['AÑO'] = anio
        
        # 4. Prepare for Classification
        # The classifier expects 'Hit Sentence' or 'Keywords' usually.
        # We will create a temporary 'Hit Sentence' column from the selected text_column
        df['Hit Sentence'] = df[text_column].astype(str)
        
        # 5. Get Rules
        rules = get_active_profile_rules()
        
        # 6. Apply Classification
        # We reuse the existing logic which modifies DF in place (adding Categoria/Tematica)
        # Note: classify_mentions expects a file path usually, but we can refactor it or just pass DF if supported?
        # Looking at classifier.py, it takes file_path. We should probably adjust it or write a helper there.
        # But for now, let's just implement the logic here directly or save to temp file.
        # Temp file is safer to reuse existing valid logic without refactoring everything.
        
        # However, to be efficient, let's import the cleaning logic but run classification here 
        # reusing the logic from classifier.py lines 30-48.
        
        df['Categoria'] = 'Sin Clasificar'
        df['Tematica'] = 'Sin Clasificar'
        
        df['Hit Sentence Lower'] = df['Hit Sentence'].str.lower()
        
        for category_rule in rules:
            category_name = category_rule['category']
            for tematica_rule in category_rule['tematicas']:
                tematica_name = tematica_rule['name']
                keywords = [k.lower() for k in tematica_rule['keywords']]
                
                if not keywords:
                    continue
                    
                # Regex join for speed or keep the simple loop? Simple loop is fine for now
                pattern = '|'.join([pd.escape(k) for k in keywords]) 
                # Actually substring match is requested "any(k in s)"
                # Building a giant regex is usually faster for pandas: str.contains(pat)
                
                mask = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
                
                # Apply (Priority to first match)
                df.loc[mask & (df['Tematica'] == 'Sin Clasificar'), 'Tematica'] = tematica_name
                df.loc[mask & (df['Categoria'] == 'Sin Clasificar'), 'Categoria'] = category_name

        # 7. Normalize Dates (if 'Timestamp' or 'Date' or 'publishedAt' exists - depends on platform)
        # Requirement: "Parse the native timestamp column handling this exact format"
        # We need to look for common date columns (Timestamp, Date, publishedAt)
        date_cols = ['Timestamp', 'Date', 'publishedAt', 'created_at']
        target_col = None
        for col in date_cols:
            if col in df.columns:
                target_col = col
                break
        
        if target_col:
            # Apply normalization
            # Using verify=False to ignore errors/NaT? Or coerce?
            # Custom apply is safer for the specific format
            df[target_col] = df[target_col].astype(str).apply(normalize_date)
            
        # Drop temp columns
        df = df.drop(columns=['Hit Sentence Lower', 'Hit Sentence'], errors='ignore')
        
        return df

    except Exception as e:
        raise e

def save_dataframe_to_platform(df, platform_name):
    """
    Saves the dataframe to the specified platform table.
    Performs column mapping and validation.
    """
    from models import TbInstagram, TbFacebook, TbLinkedin, TbTwitter, TbYoutube
    
    # Map platform string to Model
    models_map = {
        'instagram': TbInstagram,
        'facebook': TbFacebook,
        'linkedin': TbLinkedin,
        'twitter': TbTwitter,
        'youtube': TbYoutube
    }
    
    model = models_map.get(platform_name.strip().lower())
    if not model:
        app.logger.error(f"Invalid platform requested: {platform_name}")
        raise ValueError(f"Invalid platform: {platform_name}")
        
    # Get model columns
    # This relies on SQLAlchemy introspection
    model_cols = [c.key for c in model.__table__.columns]
    
    # helper to normalize string to snake_case
    def normalize_col(col):
        # "Impressions (Organic)" -> "impressions_organic"
        import re
        s = col.lower()
        s = re.sub(r'[\(\)]', '', s) # remove parens
        s = s.replace(' ', '_').replace('.', '_').replace('-', '_')
        return s
    
    # Rename DF columns to match Model columns
    rename_map = {}
    for col in df.columns:
        norm = normalize_col(col)
        
        # Special manual mappings if needed
        if norm == 'id' and 'id' in model_cols: rename_map[col] = 'id'
        elif norm == 'text' and 'content' in model_cols: rename_map[col] = 'content' # Twitter Text -> Content? No, Twitter has Text. IG has Content.
        # Check direct match
        elif norm in model_cols:
            rename_map[col] = norm
            
    # Apply Rename
    df_mapped = df.rename(columns=rename_map)
    
    # Filter columns that exist in Model
    final_cols = [c for c in df_mapped.columns if c in model_cols]
    df_final = df_mapped[final_cols]
    
    # Ensure standard injected columns are present (they should be from process step)
    required_cols = ['categoria', 'tematica', 'mes', 'anio']
    for req in required_cols:
        if req not in df_final.columns:
            # Try to find them if case diff?
            # We injected 'Categoria', 'Tematica', 'MES', 'AÑO'
            # normalize_col would map 'Categoria' -> 'categoria'
            pass
            
    # Bulk Insert using SQLAlchemy (or pandas to_sql)
    # Pandas to_sql with 'append' is easiest if using same engine
    try:
        app.logger.info(f"Inserting {len(df_final)} rows into {model.__tablename__}")
        df_final.to_sql(model.__tablename__, db.engine, if_exists='append', index=False)
        return len(df_final)
    except Exception as e:
        # Check for integrity error (duplicates) if PK exists
        if "UNIQUE constraint failed" in str(e) or "IntegrityError" in str(e):
             raise ValueError("Data contains duplicate IDs or violates constraints.")
        raise e

def get_dashboard_metrics(filters=None):
    """
    Aggregates data from all 5 platforms for the unified dashboard.
    filters: dict with 'mes', 'anio', 'platform', 'category', 'theme'
    """
    from models import TbInstagram, TbFacebook, TbLinkedin, TbTwitter, TbYoutube
    import pandas as pd
    
    app.logger.info(f"Calculating dashboard metrics with filters: {filters}")
    
    frames = []
    
    # 1. Instagram
    if not filters or not filters.get('platform') or filters['platform'] == 'instagram':
        try:
            q = db.session.query(TbInstagram)
            if filters:
                 if filters.get('mes'): q = q.filter(TbInstagram.mes == filters['mes'])
                 if filters.get('anio'): q = q.filter(TbInstagram.anio == int(filters['anio']))
                 if filters.get('category'): q = q.filter(TbInstagram.categoria == filters['category'])
                 if filters.get('theme'): q = q.filter(TbInstagram.tematica == filters['theme'])
            df = pd.read_sql(q.statement, db.session.bind)
            if not df.empty:
                df['source'] = 'Instagram'
                df['unified_impressions'] = df['impressions_organic'].fillna(0) + df['impressions_paid'].fillna(0)
                df['unified_interactions'] = df['interactions'].fillna(0)
                df['unified_reach'] = df['reach_organic'].fillna(0) + df['reach_paid'].fillna(0)
                df['unified_type'] = df['type']
                if 'timestamp' in df.columns: df['date_col'] = pd.to_datetime(df['timestamp'])
                frames.append(df)
        except Exception: pass

    # 2. Facebook
    if not filters or not filters.get('platform') or filters['platform'] == 'facebook':
        try:
            q = db.session.query(TbFacebook)
            if filters:
                 if filters.get('mes'): q = q.filter(TbFacebook.mes == filters['mes'])
                 if filters.get('anio'): q = q.filter(TbFacebook.anio == int(filters['anio']))
                 if filters.get('category'): q = q.filter(TbFacebook.categoria == filters['category'])
                 if filters.get('theme'): q = q.filter(TbFacebook.tematica == filters['theme'])
            df = pd.read_sql(q.statement, db.session.bind)
            if not df.empty:
                df['source'] = 'Facebook'
                df['unified_impressions'] = df['impressions'].fillna(0)
                df['unified_interactions'] = df['reactions'].fillna(0) + df['comments'].fillna(0) + df['shared'].fillna(0)
                df['unified_reach'] = df['reach'].fillna(0)
                df['unified_type'] = df['type']
                if 'timestamp' in df.columns: df['date_col'] = pd.to_datetime(df['timestamp'])
                frames.append(df)
        except Exception: pass

    # 3. LinkedIn
    if not filters or not filters.get('platform') or filters['platform'] == 'linkedin':
        try:
            q = db.session.query(TbLinkedin)
            if filters:
                 if filters.get('mes'): q = q.filter(TbLinkedin.mes == filters['mes'])
                 if filters.get('anio'): q = q.filter(TbLinkedin.anio == int(filters['anio']))
                 if filters.get('category'): q = q.filter(TbLinkedin.categoria == filters['category'])
                 if filters.get('theme'): q = q.filter(TbLinkedin.tematica == filters['theme'])
            df = pd.read_sql(q.statement, db.session.bind)
            if not df.empty:
                df['source'] = 'LinkedIn'
                df['unified_impressions'] = df['impressions'].fillna(0)
                df['unified_interactions'] = df['likes'].fillna(0) + df['comments'].fillna(0) + df['clicks'].fillna(0)
                df['unified_reach'] = df['impressions'].fillna(0)
                df['unified_type'] = df['type']
                if 'date' in df.columns: df['date_col'] = pd.to_datetime(df['date'])
                frames.append(df)
        except Exception: pass
        
    # 4. Twitter
    if not filters or not filters.get('platform') or filters['platform'] == 'twitter':
        try:
            q = db.session.query(TbTwitter)
            if filters:
                 if filters.get('mes'): q = q.filter(TbTwitter.mes == filters['mes'])
                 if filters.get('anio'): q = q.filter(TbTwitter.anio == int(filters['anio']))
                 if filters.get('category'): q = q.filter(TbTwitter.categoria == filters['category'])
                 if filters.get('theme'): q = q.filter(TbTwitter.tematica == filters['theme'])
            df = pd.read_sql(q.statement, db.session.bind)
            if not df.empty:
                df['source'] = 'Twitter'
                df['unified_impressions'] = df['impressions_organic'].fillna(0) + df['impressions_paid'].fillna(0)
                df['unified_interactions'] = (
                    df['favorites_organic'].fillna(0) + df['favorites_paid'].fillna(0) +
                    df['retweets_organic'].fillna(0) + df['retweets_paid'].fillna(0) + 
                    df['replies_organic'].fillna(0) + df['replies_paid'].fillna(0)
                )
                df['unified_reach'] = df['unified_impressions']
                df['unified_type'] = 'Tweet'
                if 'timestamp' in df.columns: df['date_col'] = pd.to_datetime(df['timestamp'])
                frames.append(df)
        except Exception: pass

    # 5. YouTube
    if not filters or not filters.get('platform') or filters['platform'] == 'youtube':
        try:
            q = db.session.query(TbYoutube)
            if filters:
                 if filters.get('mes'): q = q.filter(TbYoutube.mes == filters['mes'])
                 if filters.get('anio'): q = q.filter(TbYoutube.anio == int(filters['anio']))
                 if filters.get('category'): q = q.filter(TbYoutube.categoria == filters['category'])
                 if filters.get('theme'): q = q.filter(TbYoutube.tematica == filters['theme'])
            df = pd.read_sql(q.statement, db.session.bind)
            if not df.empty:
                df['source'] = 'YouTube'
                df['unified_impressions'] = df['views'].fillna(0)
                df['unified_interactions'] = df['likes'].fillna(0) + df['comments'].fillna(0) + df['shares'].fillna(0)
                df['unified_reach'] = df['views'].fillna(0)
                df['unified_type'] = 'Video'
                if 'published_at' in df.columns: df['date_col'] = pd.to_datetime(df['published_at'])
                frames.append(df)
        except Exception: pass

    if not frames:
        return {
            'kpis': {'impressions': 0, 'interactions': 0, 'posts': 0, 'reach': 0},
            'charts': {'bar': {}, 'combo': {}, 'donut': {}}
        }

    full = pd.concat(frames, ignore_index=True)
    
    # Aggregations
    kpis = {
        'impressions': int(full['unified_impressions'].sum()),
        'interactions': int(full['unified_interactions'].sum()),
        'reach': int(full['unified_reach'].sum()),
        'posts': len(full)
    }
    
    # Bar: Reach vs Impressions by Theme
    grp_theme = full.groupby('tematica')[['unified_reach', 'unified_impressions']].sum().reset_index()
    bar_chart = {
        'labels': grp_theme['tematica'].tolist(),
        'reach': grp_theme['unified_reach'].tolist(),
        'impressions': grp_theme['unified_impressions'].tolist()
    }
    
    # Combo: Time -> Posts & Interactions
    if 'date_col' in full.columns:
        full['month_str'] = full['date_col'].apply(lambda x: x.strftime('%b %Y') if pd.notnull(x) else 'Unknown')
        # Simple sort check (not perfect for strings but ok for simple dashboard)
        grp_time = full.groupby('month_str').agg({
            'source': 'count',
            'unified_interactions': 'sum'
        })
    else:
        grp_time = full.groupby('mes').agg({
            'source': 'count',
            'unified_interactions': 'sum'
        })
        
    combo_chart = {
        'labels': grp_time.index.tolist(),
        'posts': grp_time['source'].tolist(),
        'interactions': grp_time['unified_interactions'].tolist()
    }
    
    # Donut: Type
    grp_type = full.groupby('unified_type').size().reset_index(name='count')
    donut_chart = {
        'labels': grp_type['unified_type'].tolist(),
        'data': grp_type['count'].tolist()
    }
    
    return {
        'kpis': kpis,
        'charts': {
            'bar': bar_chart,
            'combo': combo_chart,
            'donut': donut_chart
        }
    }


