import pandas as pd
from services.calculation import clean_dataframe

def classify_mentions(file_path, rules_config, default_val="Sin Clasificar", use_keywords=False):
    """
    Classifies mentions based on a hierarchical rule configuration.
    
    rules_config format:
    [
        {
            "category": "Economy",
            "tematicas": [
                {"name": "Inflation", "keywords": ["prices", "cost of living"]},
                {"name": "Global", "keywords": ["fmi", "world bank"]}
            ]
        },
        ...
    ]
    """
    # 1. Reuse the existing cleaning logic
    df = clean_dataframe(file_path)
    
    # 2. Ensure classification columns exist
    if 'Tematica' not in df.columns:
        df['Tematica'] = default_val
    if 'Categoria' not in df.columns:
        df['Categoria'] = default_val
    
    # 3. Hierarchical classification - PASS 1 (Hit Sentence)
    df['Hit Sentence Lower'] = df['Hit Sentence'].fillna("").astype(str).str.lower()
    
    for category_rule in rules_config:
        category_name = str(category_rule.get('category', 'Otros'))
        tematicas = category_rule.get('tematicas', [])
        
        for tematica_rule in tematicas:
            tematica_name = str(tematica_rule.get('name', 'General'))
            keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
            
            if not keywords:
                continue
                
            mask = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
            
            # Apply labels (Priority to the first match found in the loop)
            df.loc[mask & (df['Tematica'] == default_val), 'Tematica'] = tematica_name
            df.loc[mask & (df['Categoria'] == default_val), 'Categoria'] = category_name

    # 4. Hierarchical classification - PASS 2 (Keywords Column Fallback)
    if use_keywords:
        # Ensure 'Keywords' column exists
        if 'Keywords' not in df.columns:
            # Fallback check if it was 'Keyword' in some older files, otherwise empty
            if 'Keyword' in df.columns:
                df = df.rename(columns={'Keyword': 'Keywords'})
            else:
                df['Keywords'] = ""
                
        df['Keywords Lower'] = df['Keywords'].fillna("").astype(str).str.lower()
        
        for category_rule in rules_config:
            category_name = str(category_rule.get('category', 'Otros'))
            tematicas = category_rule.get('tematicas', [])
            
            for tematica_rule in tematicas:
                tematica_name = str(tematica_rule.get('name', 'General'))
                keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
                
                if not keywords:
                    continue
                    
                mask = df['Keywords Lower'].apply(lambda s: any(k in s for k in keywords))
                
                # Only update rows that are STILL default_val after Pass 1
                df.loc[mask & (df['Tematica'] == default_val), 'Tematica'] = tematica_name
                df.loc[mask & (df['Categoria'] == default_val), 'Categoria'] = category_name

    # Remove temporary columns
    columns_to_drop = ['Hit Sentence Lower']
    if 'Keywords Lower' in df.columns:
        columns_to_drop.append('Keywords Lower')
    df = df.drop(columns=columns_to_drop)
    
    return df
