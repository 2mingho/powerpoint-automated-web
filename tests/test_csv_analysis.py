import unittest
import pandas as pd
import sys
import os
from io import StringIO

# Allow importing from parent directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services import csv_analysis

# Sample CSV data for testing
CSV_UTF8_COMMA = """Name,Age,Salary,Department,JoinDate
Alice,30,75000.5,Engineering,2020-01-15
Bob,25,55000.0,Marketing,2021-03-20
Charlie,35,85000.75,Engineering,2019-06-10
Diana,28,65000.0,Sales,2020-11-05
Eve,32,72000.25,Marketing,2021-01-12
Frank,29,,Engineering,2022-02-28
Grace,31,68000.5,Sales,2020-08-17"""

CSV_UTF16_TAB = """Product\tQuantity\tPrice\tCategory
Laptop\t50\t1200.99\tElectronics
Mouse\t200\t25.50\tAccessories
Keyboard\t150\t75.00\tAccessories
Monitor\t80\t350.00\tElectronics
Headphones\t120\t89.99\tAccessories"""


class TestCSVAnalysis(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.test_dir = "tests"
        if not os.path.exists(self.test_dir):
            os.makedirs(self.test_dir)
    
    def tearDown(self):
        """Clean up test files"""
        # Remove test CSV files
        for filename in os.listdir(self.test_dir):
            if filename.startswith("temp_test_"):
                filepath = os.path.join(self.test_dir, filename)
                try:
                    os.remove(filepath)
                except:
                    pass
    
    def test_load_csv_utf8_comma(self):
        """Test loading UTF-8 comma-separated CSV"""
        temp_file = os.path.join(self.test_dir, "temp_test_utf8.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, load_info = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        
        self.assertTrue(load_info['success'])
        self.assertEqual(len(df), 7)
        self.assertEqual(len(df.columns), 5)
        self.assertIn('Name', df.columns)
        self.assertIn('Age', df.columns)
    
    def test_load_csv_utf16_tab(self):
        """Test loading UTF-16 tab-separated CSV"""
        temp_file = os.path.join(self.test_dir, "temp_test_utf16.csv")
        
        with open(temp_file, "w", encoding="utf-16") as f:
            f.write(CSV_UTF16_TAB)
        
        df, load_info = csv_analysis.load_csv(temp_file, encoding='utf-16', separator='\t')
        
        self.assertTrue(load_info['success'])
        self.assertEqual(len(df), 5)
        self.assertEqual(len(df.columns), 4)
        self.assertIn('Product', df.columns)
    
    def test_general_info(self):
        """Test general info extraction"""
        temp_file = os.path.join(self.test_dir, "temp_test_info.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, _ = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        info = csv_analysis.general_info(df)
        
        self.assertEqual(info['row_count'], 7)
        self.assertEqual(info['column_count'], 5)
        self.assertIn('Age', info['numeric_columns'])
        self.assertIn('Salary', info['numeric_columns'])
        self.assertIn('Name', info['categorical_columns'])
        self.assertIn('Department', info['categorical_columns'])
    
    def test_missing_analysis(self):
        """Test missing value detection"""
        temp_file = os.path.join(self.test_dir, "temp_test_missing.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, _ = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        missing = csv_analysis.missing_analysis(df)
        
        # Frank has missing salary
        salary_missing = next((col for col in missing['columns_with_missing'] if col['column'] == 'Salary'), None)
        self.assertIsNotNone(salary_missing)
        self.assertEqual(salary_missing['missing_count'], 1)
        self.assertAlmostEqual(salary_missing['missing_percentage'], 14.29, places=1)
    
    def test_numeric_stats(self):
        """Test numeric statistics calculation"""
        temp_file = os.path.join(self.test_dir, "temp_test_numeric.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, _ = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        stats = csv_analysis.numeric_stats(df)
        
        self.assertGreater(len(stats['stats']), 0)
        
        # Check Age stats
        age_stats = next((s for s in stats['stats'] if s['column'] == 'Age'), None)
        self.assertIsNotNone(age_stats)
        self.assertEqual(age_stats['count'], 7)
        self.assertEqual(age_stats['min'], 25)
        self.assertEqual(age_stats['max'], 35)
        
        # Check Salary stats (6 values, 1 missing)
        salary_stats = next((s for s in stats['stats'] if s['column'] == 'Salary'), None)
        self.assertIsNotNone(salary_stats)
        self.assertEqual(salary_stats['count'], 6)
    
    def test_categorical_stats(self):
        """Test categorical statistics"""
        temp_file = os.path.join(self.test_dir, "temp_test_categorical.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, _ = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        stats = csv_analysis.categorical_stats(df)
        
        self.assertGreater(len(stats['stats']), 0)
        
        # Check Department stats
        dept_stats = next((s for s in stats['stats'] if s['column'] == 'Department'), None)
        self.assertIsNotNone(dept_stats)
        self.assertEqual(dept_stats['unique_count'], 3)  # Engineering, Marketing, Sales
        self.assertIn(dept_stats['most_common'], ['Engineering', 'Marketing', 'Sales'])
    
    def test_correlation_matrix(self):
        """Test correlation matrix calculation"""
        temp_file = os.path.join(self.test_dir, "temp_test_correlation.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        df, _ = csv_analysis.load_csv(temp_file, encoding='utf-8', separator=',')
        corr = csv_analysis.correlation_matrix(df)
        
        self.assertGreater(len(corr['columns']), 1)
        self.assertGreater(len(corr['matrix']), 0)
        
        # Check that Age correlates with itself as 1.0
        age_row = next((row for row in corr['matrix'] if row['column'] == 'Age'), None)
        self.assertIsNotNone(age_row)
        self.assertEqual(age_row['correlations']['Age'], 1.0)
    
    def test_analyze_csv_full(self):
        """Test full analysis pipeline"""
        temp_file = os.path.join(self.test_dir, "temp_test_full.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        result = csv_analysis.analyze_csv(temp_file, encoding='utf-8', separator=',')
        
        self.assertTrue(result['success'])
        self.assertIn('general', result)
        self.assertIn('missing', result)
        self.assertIn('numeric', result)
        self.assertIn('categorical', result)
        self.assertIn('correlation', result)
        self.assertIn('distributions', result)
        
        # Check general info
        self.assertEqual(result['general']['row_count'], 7)
        self.assertEqual(result['general']['column_count'], 5)
        
        # Check distributions
        self.assertIn('numeric', result['distributions'])
        self.assertIn('categorical', result['distributions'])
    
    def test_generate_summary_csv(self):
        """Test summary CSV generation"""
        temp_file = os.path.join(self.test_dir, "temp_test_summary_input.csv")
        summary_file = os.path.join(self.test_dir, "temp_test_summary_output.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        result = csv_analysis.analyze_csv(temp_file, encoding='utf-8', separator=',')
        success = csv_analysis.generate_summary_csv(result, summary_file)
        
        self.assertTrue(success)
        self.assertTrue(os.path.exists(summary_file))
        
        # Verify summary file can be read
        summary_df = pd.read_csv(summary_file, header=None)
        self.assertGreater(len(summary_df), 0)
        
        # Clean up
        if os.path.exists(summary_file):
            os.remove(summary_file)
    
    def test_invalid_encoding(self):
        """Test handling of invalid encoding"""
        temp_file = os.path.join(self.test_dir, "temp_test_invalid.csv")
        
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(CSV_UTF8_COMMA)
        
        # Try to load with wrong encoding
        result = csv_analysis.analyze_csv(temp_file, encoding='utf-16', separator=',')
        
        # Should fail gracefully
        self.assertFalse(result['success'])
        self.assertIn('error', result)


def run_test():
    """
    Test adapter for run_diagnostic.py
    """
    import unittest
    from io import StringIO
    
    suite = unittest.TestLoader().loadTestsFromTestCase(TestCSVAnalysis)
    result = unittest.TextTestRunner(stream=StringIO()).run(suite)
    
    success = result.wasSuccessful()
    details = f"Pruebas de análisis CSV: {result.testsRun} ejecutadas, {len(result.failures)} fallos, {len(result.errors)} errores."
    
    data_points = {
        "Tests Run": result.testsRun,
        "Failures": len(result.failures),
        "Errors": len(result.errors),
        "Detalle": [
            {"name": "Análisis CSV", "status": success, "diag": "Revisar lógica en csv_analysis.py si hay fallos"}
        ]
    }
    
    return success, details, data_points


if __name__ == '__main__':
    unittest.main()
