import pandas as pd
import numpy as np
from datetime import datetime
import os
import math


def safe_float(value, decimals=2):
    """
    Safely convert a value to float, handling NaN/inf for JSON serialization.
    Returns None for NaN/inf values instead of invalid JSON.
    """
    try:
        if pd.isna(value) or math.isnan(value) or math.isinf(value):
            return None
        return round(float(value), decimals)
    except (ValueError, TypeError):
        return None


def load_csv(file_path, encoding='utf-8', separator=','):
    """
    Load CSV file with specified encoding and separator.
    Returns: (DataFrame, load_info_dict)
    """
    try:
        df = pd.read_csv(file_path, encoding=encoding, sep=separator)
        
        file_size = os.path.getsize(file_path)
        
        load_info = {
            'success': True,
            'file_size_bytes': file_size,
            'file_size_mb': round(file_size / (1024 * 1024), 2),
            'encoding_used': encoding,
            'separator_used': separator,
            'error': None
        }
        
        return df, load_info
        
    except Exception as e:
        return None, {
            'success': False,
            'error': str(e),
            'encoding_used': encoding,
            'separator_used': separator
        }


def general_info(df):
    """
    Extract general information about the DataFrame.
    """
    return {
        'row_count': len(df),
        'column_count': len(df.columns),
        'columns': df.columns.tolist(),
        'memory_usage_mb': round(df.memory_usage(deep=True).sum() / (1024 * 1024), 2),
        'dtypes': df.dtypes.astype(str).to_dict(),
        'numeric_columns': df.select_dtypes(include=[np.number]).columns.tolist(),
        'categorical_columns': df.select_dtypes(include=['object', 'category']).columns.tolist(),
        'datetime_columns': df.select_dtypes(include=['datetime64']).columns.tolist()
    }


def missing_analysis(df):
    """
    Analyze missing values in the DataFrame.
    """
    total_cells = df.shape[0] * df.shape[1]
    missing_counts = df.isnull().sum()
    missing_percentages = (missing_counts / len(df) * 100).round(2)
    
    # Per-column details
    missing_details = []
    for col in df.columns:
        count = int(missing_counts[col])
        pct = safe_float(float(missing_percentages[col])) # Fixed: use safe_float
        missing_details.append({
            'column': col,
            'missing_count': count,
            'missing_percentage': pct
        })
    
    # Sort by missing count descending
    missing_details.sort(key=lambda x: x['missing_count'], reverse=True)
    
    total_missing = int(df.isnull().sum().sum())
    total_missing_pct = round((total_missing / total_cells * 100), 2) if total_cells > 0 else 0
    
    return {
        'total_missing_cells': total_missing,
        'total_missing_percentage': total_missing_pct,
        'columns_with_missing': missing_details,
        'columns_fully_complete': [col for col in df.columns if missing_counts[col] == 0]
    }


def numeric_stats(df):
    """
    Calculate statistics for numeric columns.
    """
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    
    if len(numeric_cols) == 0:
        return {'columns': [], 'stats': []}
    
    stats_list = []
    
    for col in numeric_cols:
        series = df[col].dropna()
        
        if len(series) == 0:
            continue
        
        # Use safe_float to handle NaN values
        stats_list.append({
            'column': col,
            'count': int(series.count()),
            'mean': safe_float(series.mean()),
            'median': safe_float(series.median()),
            'std': safe_float(series.std()) if len(series) > 1 else 0,
            'min': safe_float(series.min()),
            'max': safe_float(series.max()),
            'q25': safe_float(series.quantile(0.25)),
            'q75': safe_float(series.quantile(0.75)),
            'skewness': safe_float(series.skew()) if len(series) > 1 else 0,
            'kurtosis': safe_float(series.kurtosis()) if len(series) > 1 else 0
        })
    
    return {
        'columns': numeric_cols.tolist(),
        'stats': stats_list
    }


def categorical_stats(df):
    """
    Calculate statistics for categorical (object/string) columns.
    """
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns
    
    if len(categorical_cols) == 0:
        return {'columns': [], 'stats': []}
    
    stats_list = []
    
    for col in categorical_cols:
        series = df[col].dropna()
        
        if len(series) == 0:
            continue
        
        value_counts = series.value_counts()
        top_5 = value_counts.head(5).to_dict()
        
        stats_list.append({
            'column': col,
            'unique_count': int(series.nunique()),
            'most_common': str(value_counts.index[0]) if len(value_counts) > 0 else None,
            'most_common_count': int(value_counts.iloc[0]) if len(value_counts) > 0 else 0,
            'top_5_values': {str(k): int(v) for k, v in top_5.items()}
        })
    
    return {
        'columns': categorical_cols.tolist(),
        'stats': stats_list
    }


def correlation_matrix(df):
    """
    Calculate Pearson correlation matrix for numeric columns.
    """
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    
    if len(numeric_cols) < 2:
        return {
            'columns': numeric_cols.tolist(),
            'matrix': [],
            'note': 'Need at least 2 numeric columns for correlation'
        }
    
    corr = df[numeric_cols].corr()
    
    # Convert to list of lists for JSON serialization, handling NaN
    matrix_data = []
    for idx, row in corr.iterrows():
        matrix_data.append({
            'column': str(idx),
            'correlations': {str(col): safe_float(val, 3) for col, val in row.items()}
        })
    
    return {
        'columns': numeric_cols.tolist(),
        'matrix': matrix_data
    }


def distribution_data(df, max_columns=10):
    """
    Generate histogram data for numeric columns (for Chart.js).
    """
    numeric_cols = df.select_dtypes(include=[np.number]).columns[:max_columns]
    
    distributions = []
    
    for col in numeric_cols:
        series = df[col].dropna()
        
        if len(series) == 0:
            continue
        
        # Create histogram bins
        counts, bin_edges = np.histogram(series, bins=20)
        
        # Create bin labels (midpoints), handling potential NaN
        bin_labels = [(bin_edges[i] + bin_edges[i+1]) / 2 for i in range(len(bin_edges)-1)]
        
        distributions.append({
            'column': col,
            'bins': [safe_float(x) for x in bin_labels],
            'counts': [int(x) for x in counts]
        })
    
    return distributions


def categorical_distribution(df, max_columns=10):
    """
    Generate value count data for categorical columns (for Chart.js bar charts).
    """
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns[:max_columns]
    
    distributions = []
    
    for col in categorical_cols:
        series = df[col].dropna()
        
        if len(series) == 0:
            continue
        
        # Get top 10 most frequent values
        value_counts = series.value_counts().head(10)
        
        distributions.append({
            'column': col,
            'labels': [str(x) for x in value_counts.index.tolist()],
            'counts': [int(x) for x in value_counts.values.tolist()]
        })
    
    return distributions


def analyze_csv(file_path, encoding='utf-8', separator=','):
    """
    Main orchestrator function that runs all analyses.
    Returns a comprehensive JSON-serializable dictionary.
    """
    # Load the file
    df, load_info = load_csv(file_path, encoding, separator)
    
    if not load_info['success']:
        return {
            'success': False,
            'error': load_info['error'],
            'encoding': encoding,
            'separator': separator
        }
    
    # Run all analyses
    try:
        result = {
            'success': True,
            'version': '1.0.2', # Added version tag
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'file_info': load_info,
            'general': general_info(df),
            'missing': missing_analysis(df),
            'numeric': numeric_stats(df),
            'categorical': categorical_stats(df),
            'correlation': correlation_matrix(df),
            'distributions': {
                'numeric': distribution_data(df),
                'categorical': categorical_distribution(df)
            }
        }
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Error during analysis: {str(e)}',
            'encoding': encoding,
            'separator': separator
        }


def generate_summary_csv(analysis_result, output_path):
    """
    Generate a downloadable CSV summary from the analysis result.
    """
    if not analysis_result.get('success'):
        return False
    
    summary_rows = []
    
    # General info
    summary_rows.append(['INFORMACIÓN GENERAL', ''])
    summary_rows.append(['Filas', analysis_result['general']['row_count']])
    summary_rows.append(['Columnas', analysis_result['general']['column_count']])
    summary_rows.append(['Memoria (MB)', analysis_result['general']['memory_usage_mb']])
    summary_rows.append(['Tamaño archivo (MB)', analysis_result['file_info']['file_size_mb']])
    summary_rows.append([''])
    
    # Missing values
    summary_rows.append(['VALORES FALTANTES', ''])
    summary_rows.append(['Total celdas faltantes', analysis_result['missing']['total_missing_cells']])
    summary_rows.append(['Porcentaje faltante', f"{analysis_result['missing']['total_missing_percentage']}%"])
    summary_rows.append([''])
    
    # Numeric stats
    if analysis_result['numeric']['stats']:
        summary_rows.append(['ESTADÍSTICAS NUMÉRICAS', ''])
        summary_rows.append(['Columna', 'Media', 'Mediana', 'Desv.Est', 'Mín', 'Máx'])
        for stat in analysis_result['numeric']['stats']:
            summary_rows.append([
                stat['column'],
                stat['mean'],
                stat['median'],
                stat['std'],
                stat['min'],
                stat['max']
            ])
        summary_rows.append([''])
    
    # Categorical stats
    if analysis_result['categorical']['stats']:
        summary_rows.append(['ESTADÍSTICAS CATEGÓRICAS', ''])
        summary_rows.append(['Columna', 'Valores únicos', 'Más común', 'Frecuencia'])
        for stat in analysis_result['categorical']['stats']:
            summary_rows.append([
                stat['column'],
                stat['unique_count'],
                stat['most_common'],
                stat['most_common_count']
            ])
    
    # Write to CSV
    try:
        summary_df = pd.DataFrame(summary_rows)
        summary_df.to_csv(output_path, index=False, header=False, encoding='utf-8')
        return True
    except Exception as e:
        print(f"Error generating summary CSV: {e}")
        return False
