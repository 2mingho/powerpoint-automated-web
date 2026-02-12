import pandas as pd
from calculation import clean_dataframe

def classify_mentions(file_path, rules_config):
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
        df['Tematica'] = "Sin Clasificar"
    if 'Categoria' not in df.columns:
        df['Categoria'] = "Sin Clasificar"
    
    # 3. Hierarchical classification
    # Convert 'Hit Sentence' to lowercase once for efficiency
    df['Hit Sentence Lower'] = df['Hit Sentence'].fillna("").astype(str).str.lower()
    
    for category_rule in rules_config:
        category_name = category_rule.get('category', 'Otros')
        tematicas = category_rule.get('tematicas', [])
        
        for tematica_rule in tematicas:
            tematica_name = tematica_rule.get('name', 'General')
            keywords = [k.strip().lower() for k in tematica_rule.get('keywords', []) if k.strip()]
            
            if not keywords:
                continue
                
            # Create a regex pattern for better matching if needed, 
            # but simple 'any' check is what was used in the original script.
            # We'll use pandas efficient boolean indexing.
            mask = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
            
            # Apply labels (Priority to the first match found in the loop)
            # You might want to decide if a row can belong to multiple categories, 
            # but typically first-match is the standard for simple keyword classifiers.
            # We only update if it's currently "Sin Clasificar" to prevent overwriting matches
            df.loc[mask & (df['Tematica'] == "Sin Clasificar"), 'Tematica'] = tematica_name
            df.loc[mask & (df['Categoria'] == "Sin Clasificar"), 'Categoria'] = category_name

    # Remove the temporary column
    df = df.drop(columns=['Hit Sentence Lower'])
    
    return df
