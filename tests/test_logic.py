import pandas as pd
import sys
import os

# Add root to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from classifier import classify_mentions

def run_test():
    """
    Test 1: Classification Logic (Two-Pass System)
    Returns: (success, details, data_points)
    """
    try:
        # 1. Create dummy CSV
        test_csv = "test_data.csv"
        data = {
            'Hit Sentence': ['Economía bajando', '', 'Clasificado en pass 1', 'Sin relación'],
            'Keywords': ['', 'Inflación alta', 'Keywords ignoradas si pass 1 gana', 'Nada'],
            'Headline': ['', '', '', ''],
            'Source': ['Twitter', 'Facebook', 'Web', 'News'],
            'Reach': [100, 200, 300, 400],
            'Alternate Date Format': ['12-Feb-24', '12-Feb-24', '12-Feb-24', '12-Feb-24']
        }
        pd.DataFrame(data).to_csv(test_csv, sep='\t', encoding='utf-16', index=False)

        # 2. Define Rules
        rules = [{
            "category": "Economía",
            "tematicas": [
                {"name": "General", "keywords": ["economía", "inflación"]}
            ]
        }]

        # 3. Test Pass 1 & 2
        df_res = classify_mentions(test_csv, rules, default_val="Sin Clasificar", use_keywords=True)

        os.remove(test_csv)

        # 4. Validation
        results = []
        # Row 0: Hit Sentence match (Pass 1)
        pass1_success = df_res.iloc[0]['Categoria'] == 'Economía'
        results.append({"name": "Pass 1 (Hit Sentence)", "status": pass1_success})
        
        # Row 1: Keywords match (Pass 2 fallback)
        pass2_success = df_res.iloc[1]['Categoria'] == 'Economía'
        results.append({"name": "Pass 2 (Keywords Fallback)", "status": pass2_success})

        success = all(r['status'] for r in results)
        
        details = "Ambas fases de clasificación (Hit Sentence y Keywords) están funcionando correctamente." if success \
                  else "Error en la lógica de prioridad o fallback."
        
        data_points = {
            "Total Filas": len(df_res),
            "Clasificadas": len(df_res[df_res['Categoria'] != "Sin Clasificar"]),
            "Detalle": results
        }

        return success, details, data_points

    except Exception as e:
        return False, f"Crash en test de lógica: {str(e)}", {}

if __name__ == "__main__":
    print(run_test())
