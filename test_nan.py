import pandas as pd
import numpy as np
import math
import json

def safe_float(value, decimals=2):
    try:
        if pd.isna(value) or math.isnan(value) or math.isinf(value):
            return None
        return round(float(value), decimals)
    except (ValueError, TypeError):
        return None

test_values = [
    np.nan,
    float('nan'),
    np.float64(np.nan),
    pd.NA,
    None,
    np.inf,
    float('inf'),
    1.2345
]

print("Value | pd.isna | math.isnan | safe_float | JSON result")
for v in test_values:
    isna = pd.isna(v)
    try:
        is_math_nan = math.isnan(v)
    except:
        is_math_nan = "Error"
    
    sf = safe_float(v)
    jr = json.dumps(sf)
    print(f"{repr(v)} | {isna} | {is_math_nan} | {repr(sf)} | {jr}")
