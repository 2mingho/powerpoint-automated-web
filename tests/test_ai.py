import os
import sys

# Add root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import groq_analysis

def run_test():
    """
    Test 6: AI Integration (Llama3/Groq)
    Returns: (success, details, data_points)
    """
    results = []
    
    try:
        # 1. Build Prompt
        prompt = groq_analysis.construir_prompt("Test Client", "Summary data here")
        p_ok = "Test Client" in prompt and "JSON" in prompt
        results.append({"name": "Construcción de Prompt", "status": p_ok, "diag": "Error en groq_analysis.construir_prompt"})

        # 2. JSON Extraction
        mock_response = 'Context before... ```json {"test": "ok"} ``` Context after...'
        extracted = groq_analysis.extraer_json(mock_response)
        e_ok = extracted and extracted.get("test") == "ok"
        results.append({"name": "Extracción de JSON", "status": e_ok, "diag": "Error al parsear respuesta de Groq"})

        # 3. API Key Check
        key = os.getenv("GROQ_API_KEY")
        key_exists = bool(key)
        results.append({"name": "Configuración de API Key", "status": key_exists, "diag": "Falta GROQ_API_KEY en .env"})

        # 4. Live API Connection Test
        if key_exists:
            try:
                # Use a very short prompt to test connection
                test_response = groq_analysis.llamar_groq("Dime 'hola' en una palabra")
                api_ok = test_response is not None and len(test_response) > 0
                results.append({
                    "name": "Conexión en Vivo con API", 
                    "status": api_ok, 
                    "diag": "Error de conexión o API Key inválida. Revisa tu internet y el valor de GROQ_API_KEY."
                })
            except Exception as api_err:
                results.append({
                    "name": "Conexión en Vivo con API", 
                    "status": False, 
                    "diag": f"Error fatal: {str(api_err)}"
                })
        else:
            results.append({"name": "Conexión en Vivo con API", "status": False, "diag": "No se puede probar sin API Key."})

        success = all(r['status'] for r in results)
        details = "La integración con Groq (lógica y conexión) es correcta." if success else "Se detectaron fallos en la conexión o configuración de la IA."
        
        data_points = {
            "API Provider": "Groq (Llama3-70b)",
            "Prompt Length": len(prompt),
            "API Key Present": key_exists,
            "Detalle": results
        }

        return success, details, data_points

    except Exception as e:
        return False, f"Error en test de IA: {str(e)}", {}

if __name__ == "__main__":
    print(run_test())
