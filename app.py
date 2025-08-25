# app.py
import os
import uuid
import zipfile
import shutil
from datetime import datetime
from flask import Flask, render_template, request, send_file, redirect, url_for, abort, after_this_request, flash
from flask_login import LoginManager, login_required, current_user
from werkzeug.utils import secure_filename
from pptx import Presentation
from pptx.util import Inches, Pt
from babel.dates import format_datetime

from auth import auth
from extensions import db, login_manager
from models import User, Report
import calculation as report
from groq_analysis import construir_prompt, llamar_groq, extraer_json, formatear_analisis_social_listening

# ✅ NUEVO: importar herramientas de SQLAlchemy para inspección/DDL controlado
from sqlalchemy import inspect, text

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'scratch'

# Configuración general
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SECRET_KEY'] = 'super-secret-key'

db.init_app(app)
login_manager.init_app(app)

# Registrar blueprint SIEMPRE
app.register_blueprint(auth)

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])


# ✅ NUEVO: aseguramos esquema en la misma DB que usa la app
def ensure_reports_schema():
    """
    Garantiza que la tabla reports exista y tenga la columna template_name.
    Se ejecuta en el arranque de la app, usando la MISMA conexión de SQLAlchemy.
    """
    with app.app_context():
        # Crea tablas faltantes (idempotente)
        db.create_all()

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())
        if 'reports' not in tables:
            return  # la tabla se acaba de crear con create_all, ya tiene la columna.

        cols = {c['name'] for c in insp.get_columns('reports')}
        if 'template_name' not in cols:
            try:
                db.session.execute(text("ALTER TABLE reports ADD COLUMN template_name TEXT"))
                db.session.commit()
                # opcional: recargar inspector si quisieras verificar, no es necesario aquí
            except Exception as e:
                # Si hay una condición de carrera o ya existe, lo ignoramos con un log suave
                print(f"[ensure_reports_schema] Aviso al agregar columna template_name: {e}")


# Ejecutar guardado de esquema al iniciar
ensure_reports_schema()


# ─────────────────────────────────────────────────────────────
# Utilidades para plantillas
DEFAULT_TEMPLATE_FILENAME = "Reporte_plantilla.pptx"
TEMPLATES_DIR = "powerpoints"


def get_available_templates():
    """Lista segura de nombres de archivo .pptx dentro de powerpoints/"""
    try:
        files = [
            f for f in os.listdir(TEMPLATES_DIR)
            if os.path.isfile(os.path.join(TEMPLATES_DIR, f)) and f.lower().endswith(".pptx")
        ]
        return sorted(files)
    except FileNotFoundError:
        return []


def template_path_from_name(template_name):
    """Construye la ruta absoluta segura a la plantilla."""
    safe_name = os.path.basename(template_name)  # evita traversal
    return os.path.join(TEMPLATES_DIR, safe_name)


def clean_scratch_folder():
    folder = app.config['UPLOAD_FOLDER']
    try:
        for file in os.listdir(folder):
            file_path = os.path.join(folder, file)
            if os.path.isfile(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
    except Exception as e:
        print(f"Error al limpiar la carpeta scratch: {e}")


@app.route('/menu')
@login_required
def menu():
    return render_template('menu.html')


@app.route('/', methods=['GET', 'POST'])
@login_required
def index():
    clean_scratch_folder()

    available_templates = get_available_templates()
    default_template = DEFAULT_TEMPLATE_FILENAME if DEFAULT_TEMPLATE_FILENAME in available_templates else (available_templates[0] if available_templates else None)

    if request.method == 'POST':
        csv_file = request.files.get('csv_file')
        wordcloud_file = request.files.get('wordcloud_file')
        report_title = request.form.get('report_title', '').strip()
        description = request.form.get('description', '').strip()
        selected_template = request.form.get('template_name', default_template)
        fallback_default = bool(request.form.get('fallback_default'))

        if not csv_file or not csv_file.filename.endswith('.csv'):
            return redirect(url_for('error_archivo_invalido'))

        # Validar plantilla seleccionada
        if not available_templates:
            flash("No hay plantillas disponibles en el servidor. Contacta al administrador.", "error")
            return render_template('index.html',
                                   available_templates=[],
                                   default_template=None)

        if selected_template not in available_templates:
            if fallback_default and default_template:
                flash(f"La plantilla seleccionada no existe. Se usará la predeterminada: {default_template}.", "warning")
                selected_template = default_template
            else:
                flash("La plantilla seleccionada no existe. Por favor elige otra o marca 'Usar la plantilla predeterminada'.", "error")
                return render_template('index.html',
                                       available_templates=available_templates,
                                       default_template=default_template)

        unique_id = uuid.uuid4().hex[:6]
        csv_filename = secure_filename(csv_file.filename)
        csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{unique_id}_{csv_filename}")
        csv_file.save(csv_path)

        wordcloud_path = None
        if wordcloud_file and wordcloud_file.filename.endswith('.png'):
            wordcloud_path = os.path.join(app.config['UPLOAD_FOLDER'], 'Wordcloud.png')
            wordcloud_file.save(wordcloud_path)

        try:
            zip_path, missing_fields, used_template = process_report(
                csv_path=csv_path,
                wordcloud_path=wordcloud_path,
                unique_id=unique_id,
                template_filename=selected_template,
                report_title=report_title,
                description=description
            )
        except Exception as e:
            print(f"Error generando el reporte: {e}")
            abort(500)

        if missing_fields:
            faltantes = ", ".join(sorted(set(missing_fields)))
            flash(f"Advertencia: La plantilla '{used_template}' no contiene algunos campos esperados y fueron omitidos: {faltantes}.", "warning")

        zip_filename = os.path.basename(zip_path)
        file_size_mb = round(os.path.getsize(zip_path) / (1024 * 1024), 2)
        current_time = datetime.now()
        formatted_datetime = format_datetime(current_time, "d 'de' MMMM, yyyy - HH:mm", locale='es')

        return render_template(
            'download.html',
            zip_path=zip_filename,
            file_size=file_size_mb,
            formatted_datetime=formatted_datetime,
            template_used=used_template
        )

    # GET
    return render_template('index.html',
                           available_templates=available_templates,
                           default_template=default_template)


def process_report(csv_path, wordcloud_path, unique_id, template_filename, report_title=None, description=None):
    """
    Genera el zip del reporte usando la plantilla indicada.
    Devuelve: (zip_path, missing_fields_list, used_template_filename)
    """
    missing_fields = []

    # Carga y limpieza
    df_cleaned = report.load_and_clean_data(csv_path)
    df_cleaned['Influencer'] = df_cleaned.apply(report.update_influencer, axis=1)
    df_cleaned['Sentiment'] = df_cleaned.apply(report.update_sentiment, axis=1)

    total_mentions, count_of_authors, estimated_reach = report.calculate_summary_metrics(df_cleaned)
    processed_csv_path = report.save_cleaned_csv(df_cleaned, csv_path, unique_id)

    solo_fecha = request.form.get('solo_fecha') is not None
    if solo_fecha:
        report.create_mentions_evolution_chart_by_date(df_cleaned)
    else:
        report.create_mentions_evolution_chart(df_cleaned)

    report.create_sentiment_pie_chart(df_cleaned)

    platform_counts, _ = report.distribucion_plataforma(df_cleaned)
    top_sentences = report.get_top_hit_sentences(df_cleaned)
    top_influencers_prensa = report.get_top_influencers(df_cleaned, 'Prensa Digital', sort_by='Posts')
    top_influencers_redes_posts = report.get_top_influencers(df_cleaned, 'Redes Sociales', sort_by='Posts', include_source=True)
    top_influencers_redes_reach = report.get_top_influencers(df_cleaned, 'Redes Sociales', sort_by='Max Reach')

    current_date = datetime.now().strftime('%d-%b-%Y')
    client_name = report_title if report_title else os.path.basename(csv_path).split()[0]

    # Abrir plantilla seleccionada
    tpl_path = template_path_from_name(template_filename)
    if not os.path.isfile(tpl_path):
        raise FileNotFoundError(f"Plantilla no encontrada: {tpl_path}")

    prs = Presentation(tpl_path)

    # Helper interno para reemplazar placeholders y marcar faltantes
    def replace_placeholders(slide, mapping, missing):
        found_keys = set()
        for shape in slide.shapes:
            if shape.has_text_frame:
                for key, value in mapping.items():
                    if key in shape.text:
                        report.set_text_style(shape, str(value), 'Effra Heavy', Pt(28), False if key not in ("NUMB_MENTIONS", "NUMB_ACTORS", "EST_REACH") else True)
                        found_keys.add(key)
        for key in mapping.keys():
            if key not in found_keys:
                missing.append(key)

    # Slide 1
    if len(prs.slides) > 0:
        slide1 = prs.slides[0]
        replace_placeholders(slide1, {"REPORT_CLIENT": client_name, "REPORT_DATE": current_date}, missing_fields)
    else:
        missing_fields.extend(["REPORT_CLIENT", "REPORT_DATE"])

    # Slide 2
    if len(prs.slides) > 1:
        slide2 = prs.slides[1]
        # KPIs
        replace_placeholders(slide2, {
            "NUMB_MENTIONS": str(total_mentions),
            "NUMB_ACTORS": str(count_of_authors),
            "EST_REACH": estimated_reach
        }, missing_fields)
        # Evolución de conversación
        try:
            slide2.shapes.add_picture('scratch/convEvolution.png', Inches(0.9), Inches(1.2), width=Inches(9.55), height=Inches(5.14))
        except Exception:
            missing_fields.append("CONVERSATION_CHART")
    else:
        missing_fields.extend(["NUMB_MENTIONS", "NUMB_ACTORS", "EST_REACH", "CONVERSATION_CHART"])

    # Slide 3
    if len(prs.slides) > 2:
        slide3 = prs.slides[2]
        # Top news
        try:
            for shape in slide3.shapes:
                if shape.has_text_frame:
                    if "TOP_NEWS" in shape.text:
                        report.set_text_style(shape, "\n".join(top_sentences), 'Effra Light', Pt(12), False)
                        break
            else:
                missing_fields.append("TOP_NEWS")
        except Exception:
            missing_fields.append("TOP_NEWS")

        # Análisis Groq
        analisis_texto = "No disponible"
        try:
            parrafos = "\n".join(df_cleaned['Hit Sentence'].dropna().astype(str).tolist()[:80])
            prompt = construir_prompt(client_name, parrafos)
            respuesta = llamar_groq(prompt)
            if respuesta:
                resultado_json = extraer_json(respuesta)
                if isinstance(resultado_json, dict):
                    analisis_texto = formatear_analisis_social_listening(resultado_json)
        except Exception:
            analisis_texto = "No disponible"

        try:
            for shape in slide3.shapes:
                if shape.has_text_frame and "CONVERSATION_ANALISIS" in shape.text:
                    report.set_text_style(shape, analisis_texto, 'Effra Light', Pt(11), False)
                    break
            else:
                missing_fields.append("CONVERSATION_ANALISIS")
        except Exception:
            missing_fields.append("CONVERSATION_ANALISIS")

        # Wordcloud opcional
        try:
            if wordcloud_path and os.path.exists(wordcloud_path):
                slide3.shapes.add_picture(wordcloud_path, Inches(7.5), Inches(3.5), width=Inches(4.2), height=Inches(2.66))
            else:
                missing_fields.append("WORDCLOUD")
        except Exception:
            missing_fields.append("WORDCLOUD")
    else:
        missing_fields.extend(["TOP_NEWS", "CONVERSATION_ANALISIS", "WORDCLOUD"])

    # Slide 4
    if len(prs.slides) > 3:
        slide4 = prs.slides[3]
        try:
            slide4.shapes.add_picture('scratch/sentiment_pie_chart.png', Inches(1), Inches(1), width=Inches(6), height=Inches(6))
        except Exception:
            missing_fields.append("SENTIMENT_PIE")
    else:
        missing_fields.append("SENTIMENT_PIE")

    # Slide 5
    if len(prs.slides) > 4:
        slide5 = prs.slides[4]
        try:
            for shape in slide5.shapes:
                if shape.has_text_frame and "NUMB_PRENSA" in shape.text:
                    report.set_text_style(shape, str(platform_counts.get('Prensa Digital', 0)), font_size=Pt(28))
                    break
            else:
                missing_fields.append("NUMB_PRENSA")

            try:
                report.add_dataframe_as_table(slide5, top_influencers_prensa, Inches(2.65), Inches(2), Inches(8), Inches(4))
            except Exception:
                missing_fields.append("TOP_INFLUENCERS_PRENSA_TABLE")
        except Exception:
            missing_fields.extend(["NUMB_PRENSA", "TOP_INFLUENCERS_PRENSA_TABLE"])
    else:
        missing_fields.extend(["NUMB_PRENSA", "TOP_INFLUENCERS_PRENSA_TABLE"])

    # Slide 6
    if len(prs.slides) > 5:
        slide6 = prs.slides[5]
        try:
            for shape in slide6.shapes:
                if shape.has_text_frame and "NUMB_REDES" in shape.text:
                    report.set_text_style(shape, str(platform_counts.get('Redes Sociales', 0)), font_size=Pt(28))
                    break
            else:
                missing_fields.append("NUMB_REDES")

            try:
                report.add_dataframe_as_table(slide6, top_influencers_redes_posts, Inches(0.56), Inches(2), Inches(7), Inches(4))
            except Exception:
                missing_fields.append("TOP_INFLUENCERS_REDES_POSTS_TABLE")

            try:
                report.add_dataframe_as_table(slide6, top_influencers_redes_reach, Inches(8), Inches(2), Inches(5), Inches(4))
            except Exception:
                missing_fields.append("TOP_INFLUENCERS_REDES_REACH_TABLE")
        except Exception:
            missing_fields.extend(["NUMB_REDES", "TOP_INFLUENCERS_REDES_POSTS_TABLE", "TOP_INFLUENCERS_REDES_REACH_TABLE"])
    else:
        missing_fields.extend(["NUMB_REDES", "TOP_INFLUENCERS_REDES_POSTS_TABLE", "TOP_INFLUENCERS_REDES_REACH_TABLE"])

    # Guardado de archivos
    safe_title = secure_filename(report_title) if report_title else f"Reporte_{unique_id}"
    pptx_filename = f"{safe_title}.pptx"
    pptx_path = os.path.join(app.config['UPLOAD_FOLDER'], pptx_filename)
    prs.save(pptx_path)

    zip_filename = f"{safe_title}.zip"
    zip_path = os.path.join(app.config['UPLOAD_FOLDER'], zip_filename)
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        zipf.write(pptx_path, arcname=pptx_filename)
        zipf.write(processed_csv_path, arcname=os.path.basename(processed_csv_path))

    # Persistencia del reporte con plantilla usada
    new_report = Report(
        filename=zip_filename,
        user_id=current_user.id,
        title=report_title,
        description=description,
        template_name=template_filename
    )
    db.session.add(new_report)
    db.session.commit()

    return zip_path, missing_fields, template_filename


@app.route('/download/<path:filename>')
@login_required
def download_file(filename):
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(full_path):
        abort(404)

    @after_this_request
    def cleanup(response):
        clean_scratch_folder()
        return response

    return send_file(full_path, as_attachment=True)


@app.route('/mis-reportes')
@login_required
def mis_reportes():
    user_reports = Report.query.filter_by(user_id=current_user.id).order_by(Report.created_at.desc()).all()
    return render_template('mis_reportes.html', reports=user_reports)


@app.context_processor
def inject_current_year():
    return {'current_year': datetime.now().year}


@app.route('/error/archivo-invalido')
def error_archivo_invalido():
    return render_template('error.html',
                           title="Archivo inválido",
                           message="El archivo que subiste no es válido o tiene un formato incorrecto.")


@app.route('/clasificacion')
@login_required
def clasificacion():
    return render_template('clasificacion.html')


@app.route('/union')
@login_required
def union_archivos():
    return render_template('union.html')


@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html',
                           title="Error 404 - Página no encontrada",
                           message="La página que estás buscando no existe."), 404


@app.errorhandler(500)
def internal_error(e):
    return render_template('error.html',
                           title="Error 500 - Problema del servidor",
                           message="Ocurrió un error inesperado. Por favor, intenta más tarde."), 500


if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)