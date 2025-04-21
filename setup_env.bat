@echo off
SETLOCAL

echo ----------------------------------------------
echo 🧠 Ejecutando app Flask de Data Intelligence
echo ----------------------------------------------

REM Verificar si existe el entorno virtual
IF NOT EXIST "venv\Scripts\activate" (
    echo ⚙️ Entorno virtual no encontrado. Creando entorno virtual...
    python -m venv venv
)

REM Activar entorno virtual
call venv\Scripts\activate

REM Instalar dependencias
echo 📦 Instalando librerías desde requirements.txt...
pip install -r requirements.txt

REM Ejecutar la app
echo 🚀 Iniciando la aplicación...
python app.py

ENDLOCAL
pause