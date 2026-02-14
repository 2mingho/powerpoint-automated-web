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
echo 📦 Instalando librerias desde requirements.txt...
pip install -r requirements.txt
pip install pytest >nul 2>&1

REM Inicializar/actualizar base de datos
echo 🗃️ Verificando base de datos...
python init_db.py

REM Ejecutar la app
echo 🚀 Iniciando la aplicacion...
python app.py

ENDLOCAL
pause