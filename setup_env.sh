#!/bin/bash

echo "-----------------------------------"
echo "🧠 Ejecutando app Flask de Data Intel"
echo "-----------------------------------"

# Verificar que Python 3 esté instalado
if ! command -v python3 &> /dev/null
then
    echo "❌ Python 3 no está instalado. Instálalo antes de continuar."
    exit 1
fi

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "⚙️ Entorno virtual no encontrado. Creando entorno virtual..."
    python3 -m venv venv
fi

# Activar entorno virtual
source venv/bin/activate

# Instalar dependencias
echo "📦 Instalando librerías desde requirements.txt..."
pip install -r requirements.txt

# Ejecutar la app
echo "🚀 Iniciando la aplicación..."
python app.py