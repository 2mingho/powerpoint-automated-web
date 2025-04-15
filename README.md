# 📊 PowerPoint Automated Web

Aplicación web para generar reportes automáticos a partir de archivos CSV con visualizaciones, análisis de menciones y generación de presentaciones en PowerPoint. Incluye autenticación de usuarios, almacenamiento de reportes y descarga de archivos generados.

---

## ⚙️ Requisitos

- Python 3.10 o superior
- Git (opcional, si clonas el repositorio)
- Entorno Windows (usa `.bat` para automatización)

---

## 🚀 Cómo ejecutar el proyecto

1. Clona el proyecto o descárgalo como ZIP.
2. Abre una terminal en la carpeta raíz del proyecto.
3. Ejecuta el script de entorno:

setup_env.bat

### Este comando hará lo siguiente:
1. Crear un entorno virtual (venv/)
2. Activarlo
3. Instalar todas las dependencias desde requirements.txt
4. Lanzar la aplicación automáticamente en http://localhost:5000/

---

## 🧩 Estructura del proyecto

POWERPOINT-AUTOMATED-WEB/
│
├── app.py                   # Lógica principal y rutas
├── auth.py                  # Login, registro, logout
├── calculation.py           # Procesamiento de datos y gráficos
├── models.py                # Modelos de base de datos
├── extensions.py            # DB y login manager
├── requirements.txt         # Librerías necesarias
├── setup_env.bat            # Script de entorno virtual + ejecución
├── users.db                 # Base de datos SQLite
│
├── scratch/                 # Archivos generados temporalmente
├── powerpoints/
│   └── Reporte_plantilla.pptx
│
├── static/
│   ├── css/
│   │   └── style.css        # Estilos globales
│   └── img/
│       └── logo.ico
│
├── templates/
│   ├── base.html
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── download.html
│   ├── mis_reportes.html
│   └── error.html

---

## ✅ Funcionalidades

* Registro e inicio de sesión
* Generación de reportes desde CSV
* Wordcloud opcional
* Visualización de reportes anteriores por usuario
* Descarga del archivo ZIP con presentación y CSV
* Interfaz responsive y moderna

---

## 📌 Notas

* Los reportes se eliminan del servidor después de su descarga.
* Asegúrate de que los archivos CSV estén codificados en UTF-16.
* Puedes personalizar el diseño desde style.css o las plantillas HTML.