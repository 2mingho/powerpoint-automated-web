import os
import sys
import platform

def run_test():
    """
    Test 2: Environment & Infrastructure
    Returns: (success, details, data_points)
    """
    results = []
    
    # 1. Check Python Version
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}"
    v_ok = sys.version_info.major == 3 and sys.version_info.minor >= 10
    results.append({"name": f"Python Version ({py_ver})", "status": v_ok, "diag": "Usa Python 3.10+"})

    # 2. Check Folders
    folders = ['scratch', 'powerpoints']
    for f in folders:
        exists = os.path.exists(f)
        results.append({"name": f"Carpeta '{f}'", "status": exists, "diag": f"Crear carpeta {f}"})

    # 3. Check .env
    env_exists = os.path.exists(".env")
    results.append({"name": "Archivo .env", "status": env_exists, "diag": "Crea un .env con GROQ_API_KEY"})

    success = all(r['status'] for r in results)
    details = "Entorno configurado correctamente." if success else "Se detectaron problemas en la infraestructura del servidor."
    
    data_points = {
        "OS": platform.system(),
        "Architecture": platform.machine(),
        "Detalle": results
    }

    return success, details, data_points

if __name__ == "__main__":
    print(run_test())
