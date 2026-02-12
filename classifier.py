import pandas as pd
from calculation import clean_dataframe

def classify_mentions(file_path, rules_config, default_val="Sin Clasificar"):
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
    
    # 3. Hierarchical classification
    # Convert 'Hit Sentence' and 'Keyword' to lowercase once for efficiency
    df['Hit Sentence Lower'] = df['Hit Sentence'].fillna("").astype(str).str.lower()
    
    # Ensure 'Keyword' column exists, if not create empty one for fallback logic
    if 'Keyword' not in df.columns:
        df['Keyword'] = ""
    df['Keyword Lower'] = df['Keyword'].fillna("").astype(str).str.lower()
    
    for category_rule in rules_config:
        category_name = category_rule.get('category', 'Otros')
        tematicas = category_rule.get('tematicas', [])
        
        for tematica_rule in tematicas:
            tematica_name = tematica_rule.get('name', 'General')
            keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
            
            if not keywords:
                continue
                
            # Phase 1: Match against Hit Sentence
            mask_hit = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
            
            # Phase 2: Fallback - Match against Keyword column if not already matched
            # We only apply fallback to rows that are still the default_val
            mask_keyword = df['Keyword Lower'].apply(lambda s: any(k in s for k in keywords))
            
            # Apply labels (Priority to Hit Sentence, then Keyword)
            # Update rows that haven't been classified yet (still have default_val)
            mask_to_classify = (df['Tematica'] == default_val)
            
            # Combine masks: Rows that match in Hit OR match in Keyword
            mask_total = mask_hit | mask_keyword
            
            df.loc[mask_total & mask_to_classify, 'Tematica'] = tematica_name
            df.loc[mask_total & mask_to_classify, 'Categoria'] = category_name

    # Remove temporary columns
    df = df.drop(columns=['Hit Sentence Lower', 'Keyword Lower'])
    
    return df
