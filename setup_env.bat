@echo off
SETLOCAL

echo ==============================
echo   Configurando entorno venv...
echo ==============================

REM Crear entorno si no existe
IF NOT EXIST "venv" (
    echo ➤ Creando entorno virtual...
    python -m venv venv
)

REM Activar entorno
echo ➤ Activando entorno virtual...
call venv\Scripts\activate.bat

REM Instalar dependencias
echo ➤ Instalando dependencias...
pip install --upgrade pip >nul
pip install -r requirements.txt

echo ==============================
echo   Ejecutando app.py...
echo ==============================

python app.py

ENDLOCAL
pause