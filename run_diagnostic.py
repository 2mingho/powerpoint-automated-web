import os
import sys
import importlib
import json
import time
from datetime import datetime

# Simple HTML Template with App Aesthetic
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Diagnóstico de Sistema | Powerpoint Automated</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {{ --primary: #3f3fff; --success: #2ecc71; --error: #e74c3c; --warning: #f1c40f; }}
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7fe; color: #333; margin: 0; padding: 40px; }}
        .header {{ margin-bottom: 40px; text-align: center; position: relative; }}
        .card {{ background: #fff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); padding: 30px; margin-bottom: 30px; border: 1px solid #eee; break-inside: avoid; }}
        .badge {{ padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; text-transform: uppercase; }}
        .badge-success {{ background: #e8f5e9; color: var(--success); }}
        .badge-error {{ background: #ffebee; color: var(--error); }}
        .test-row {{ display: flex; justify-content: space-between; padding: 15px 0; border-bottom: 1px solid #f0f0f0; align-items: center; }}
        .diagnostic-box {{ background: #fff8e1; border-left: 4px solid var(--warning); padding: 15px; margin-top: 20px; border-radius: 4px; font-size: 0.9rem; }}
        .chart-container {{ max-width: 400px; margin: 0 auto; }}
        .btn-export {{ 
            position: absolute; right: 0; top: 0;
            background: var(--primary); color: white; border: none; padding: 10px 20px; 
            border-radius: 8px; cursor: pointer; font-weight: bold; transition: opacity 0.2s;
            display: flex; align-items: center; gap: 8px;
        }}
        .btn-export:hover {{ opacity: 0.9; }}
        
        @media print {{
            body {{ background: white; padding: 20px; }}
            .btn-export {{ display: none !important; }}
            .card {{ box-shadow: none; border: 1px solid #ddd; }}
            @page {{ margin: 1cm; }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <button class="btn-export" onclick="window.print()">
            <i class="fa-solid fa-file-pdf"></i> Guardar como PDF
        </button>
        <h1><i class="fa-solid fa-stethoscope" style="color: var(--primary);"></i> Diagnóstico de Sistema</h1>
        <p>Reporte generado el {timestamp}</p>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px;">
        <div class="card">
            <h2 style="margin-top:0;">Resumen General</h2>
            <div class="chart-container"><canvas id="summaryChart"></canvas></div>
        </div>
        <div class="card">
            <h2 style="margin-top:0;">Estadísticas Rápidas</h2>
            <div style="font-size: 1.1rem;">
                <p><strong>Total Tests:</strong> {total}</p>
                <p><strong>Exitosos:</strong> <span style="color:var(--success)">{passed}</span></p>
                <p><strong>Fallidos:</strong> <span style="color:var(--error)">{failed}</span></p>
                <p><strong>Tiempo Ejecución:</strong> {duration}s</p>
            </div>
        </div>
    </div>

    {content}

    <script>
        const ctx = document.getElementById('summaryChart').getContext('2d');
        new Chart(ctx, {{
            type: 'doughnut',
            data: {{
                labels: ['Exitosos', 'Fallidos'],
                datasets: [{{
                    data: [{passed}, {failed}],
                    backgroundColor: ['#2ecc71', '#e74c3c'],
                    borderWidth: 0
                }}]
            }},
            options: {{ 
                animation: false,
                cutout: '70%', 
                plugins: {{ legend: {{ position: 'bottom' }} }} 
            }}
        }});
    </script>
</body>
</html>
"""

def generate_report():
    print("Iniciando Diagnóstico...")
    start_time = time.time()
    test_results = []
    
    # Discovery: look into tests/ folder
    tests_dir = "tests"
    if not os.path.exists(tests_dir):
        print("Error: No se encontró la carpeta 'tests/'")
        return

    # Add tests dir to path
    sys.path.append(os.path.abspath(tests_dir))
    
    for filename in os.listdir(tests_dir):
        if filename.startswith("test_") and filename.endswith(".py"):
            module_name = filename[:-3]
            try:
                module = importlib.import_module(module_name)
                if hasattr(module, 'run_test'):
                    success, details, data = module.run_test()
                    test_results.append({
                        "name": module_name.replace("test_", "").capitalize(),
                        "success": success,
                        "details": details,
                        "data": data
                    })
            except Exception as e:
                test_results.append({
                    "name": filename,
                    "success": False,
                    "details": f"Error cargando test: {str(e)}",
                    "data": {}
                })

    # Build HTML Content
    html_content = ""
    passed_count = sum(1 for r in test_results if r['success'])
    failed_count = len(test_results) - passed_count
    
    for res in test_results:
        badge_class = "badge-success" if res['success'] else "badge-error"
        status_text = "PASSED" if res['success'] else "FAILED"
        
        detail_rows = ""
        if 'Detalle' in res['data']:
            for d in res['data']['Detalle']:
                icon = '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i>' if d['status'] else '<i class="fa-solid fa-circle-xmark" style="color:var(--error)"></i>'
                diag_msg = f'<br><small style="color:var(--error)">Diagnóstico: {d["diag"]}</small>' if not d['status'] and 'diag' in d else ""
                detail_rows += f'<div class="test-row"><span>{icon} {d["name"]}</span> {diag_msg}</div>'

        html_content += f"""
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0;">{res['name']}</h3>
                <span class="badge {badge_class}">{status_text}</span>
            </div>
            <p style="color: #666; margin-top:10px;">{res['details']}</p>
            <div style="margin-top:20px;">
                {detail_rows}
            </div>
        </div>
        """

    # Final Save
    report_html = HTML_TEMPLATE.format(
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        total=len(test_results),
        passed=passed_count,
        failed=failed_count,
        duration=round(time.time() - start_time, 2),
        content=html_content
    )
    
    with open("diagnostic_report.html", "w", encoding="utf-8") as f:
        f.write(report_html)
    
    print(f"Diagnóstico completado. Reporte generado: diagnostic_report.html ({passed_count}/{len(test_results)} ok)")

if __name__ == "__main__":
    generate_report()
