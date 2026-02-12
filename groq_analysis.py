import os
import json
import re
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama3-70b-8192"

# Startup validation (R1)
if not GROQ_API_KEY or GROQ_API_KEY == "no_api_key_provided":
    import warnings
    warnings.warn("GROQ_API_KEY not configured. AI analysis will fail. Set it in .env file.")

def construir_prompt(entidad, menciones):
    return f"""Analiza las siguientes menciones de redes sociales sobre {entidad}. Devuelve **solo un objeto JSON válido**. No incluyas explicaciones, encabezados ni formato de Markdown.

Estructura esperada:
{{
  "temas_principales": [
    {{ "tema": "...", "descripcion": "..." }},
    ...
  ],
  "sentimiento_general": {{
    "positivo": {{ "porcentaje": ..., "ejemplo": "..." }},
    "negativo": {{ "porcentaje": ..., "ejemplo": "..." }},
    "neutro": {{ "porcentaje": ..., "ejemplo": "..." }}
  }},
  "hallazgos_destacados": "..."
}}

A continuación, las menciones:
{menciones}
"""

def llamar_groq(prompt):
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3
    }

    response = requests.post(GROQ_URL, headers=headers, json=data, timeout=30)

    if response.status_code == 200:
        content = response.json()["choices"][0]["message"]["content"]
        return content
    else:
        print("[ERROR] Error en la API:", response.status_code, response.text)
        return None

def extraer_json(respuesta):
    match = re.search(r"\{.*\}", respuesta, re.DOTALL)
    if match:
        raw_json = match.group(0)
        try:
            parsed = json.loads(raw_json)
            return parsed
        except json.JSONDecodeError:
            print("⚠️ Error al parsear el JSON.")
            print(raw_json)
            # return None   # TEMPORAL FIX
            return raw_json
    else:
        print("⚠️ No se encontró ningún JSON en la respuesta.")
        print(respuesta)
        return None

def formatear_analisis_social_listening(data):
    output = []

    # Temas principales
    output.append("* Temas Principales:\n")
    for i, tema in enumerate(data.get("temas_principales", []), 1):
        output.append(f"{i}. {tema['tema']}\n{tema['descripcion']}\n")

    # Sentimiento general
    sentimiento = data.get("sentimiento_general", {})
    output.append("* Sentimiento General")
    if "positivo" in sentimiento:
        output.append(f"Positivo: {sentimiento['positivo']['ejemplo']} ({sentimiento['positivo']['porcentaje']}%)")
    if "neutro" in sentimiento:
        output.append(f"Neutro: {sentimiento['neutro']['ejemplo']} ({sentimiento['neutro']['porcentaje']}%)")
    if "negativo" in sentimiento:
        output.append(f"Negativo: {sentimiento['negativo']['ejemplo']} ({sentimiento['negativo']['porcentaje']}%)")

    # Hallazgos
    hallazgos = data.get("hallazgos_destacados", "")
    output.append("\n* Hallazgos destacados:\n" + hallazgos)

    return "\n\n".join(output)