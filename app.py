# app.py
import os
import uuid
import zipfile
import shutil
from datetime import datetime
from flask import Flask, render_template, request, send_file, redirect, url_for, abort, after_this_request
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

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'scratch'

# Configuración general
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SECRET_KEY'] = 'super-secret-key'

db.init_app(app)
login_manager.init_app(app)

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

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

@app.route('/', methods=['GET', 'POST'])
@login_required
def index():
    clean_scratch_folder()

    if request.method == 'POST':
        csv_file = request.files.get('csv_file')
        wordcloud_file = request.files.get('wordcloud_file')
        report_title = request.form.get('report_title', '').strip()
        description = request.form.get('description', '').strip()

        if not csv_file or not csv_file.filename.endswith('.csv'):
            return redirect(url_for('error_archivo_invalido'))

        unique_id = uuid.uuid4().hex[:6]
        csv_filename = secure_filename(csv_file.filename)
        csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{unique_id}_{csv_filename}")
        csv_file.save(csv_path)

        wordcloud_path = None
        if wordcloud_file and wordcloud_file.filename.endswith('.png'):
            wordcloud_path = os.path.join(app.config['UPLOAD_FOLDER'], 'Wordcloud.png')
            wordcloud_file.save(wordcloud_path)

        try:
            zip_path = process_report(csv_path, wordcloud_path, unique_id, report_title, description)
        except Exception as e:
            print(f"Error generando el reporte: {e}")
            abort(500)

        zip_filename = os.path.basename(zip_path)
        file_size_mb = round(os.path.getsize(zip_path) / (1024 * 1024), 2)
        current_time = datetime.now()
        formatted_datetime = format_datetime(current_time, "d 'de' MMMM, yyyy - HH:mm", locale='es')

        return render_template(
            'download.html',
            zip_path=zip_filename,
            file_size=file_size_mb,
            formatted_datetime=formatted_datetime
        )

    return render_template('index.html')

def process_report(csv_path, wordcloud_path, unique_id, report_title=None, description=None):
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
    current_date_file_name = datetime.now().strftime('%d-%b-%Y, %H %M %S')
    client_name = report_title if report_title else os.path.basename(csv_path).split()[0]

    prs = Presentation("powerpoints/Reporte_plantilla.pptx")

    # Slide 1
    slide1 = prs.slides[0]
    for shape in slide1.shapes:
        if shape.has_text_frame:
            for key, value in {"REPORT_CLIENT": client_name, "REPORT_DATE": current_date}.items():
                if key in shape.text:
                    report.set_text_style(shape, str(value), 'Effra Heavy', Pt(28), False)

    # Slide 2
    slide2 = prs.slides[1]
    for shape in slide2.shapes:
        if shape.has_text_frame:
            for key, value in {
                "NUMB_MENTIONS": str(total_mentions),
                "NUMB_ACTORS": str(count_of_authors),
                "EST_REACH": estimated_reach
            }.items():
                if key in shape.text:
                    report.set_text_style(shape, value, font_name='Effra Heavy' ,font_size=Pt(24), center=True)
        elif shape.shape_type == 13:
            slide2.shapes.add_picture('scratch/convEvolution.png', Inches(0.9), Inches(1.2), width=Inches(9.55), height=Inches(5.14))

    # Slide 3
    slide3 = prs.slides[2]
    for shape in slide3.shapes:
        if shape.has_text_frame:
            if "TOP_NEWS" in shape.text:
                report.set_text_style(shape, "\n".join(top_sentences), 'Effra Light', Pt(12), False)
            if "CONVERSATION_ANALISIS" in shape.text:
                # Realizar análisis automático
                parrafos = "\n".join(df_cleaned['Hit Sentence'].dropna().astype(str).tolist()[:80])
                prompt = construir_prompt(client_name, parrafos)
                respuesta = llamar_groq(prompt)
                analisis_texto = "No disponible"
                if respuesta:
                    resultado_json = extraer_json(respuesta)
                    if resultado_json:
                        analisis_texto = formatear_analisis_social_listening(resultado_json)
                report.set_text_style(shape, analisis_texto, 'Effra Light', Pt(11), False)

    try:
        slide3.shapes.add_picture('scratch/Wordcloud.png', Inches(7.5), Inches(3.5), width=Inches(4.2), height=Inches(2.66))
    except Exception as e:
        print("Error al insertar Wordcloud:", e)

    # Slide 4
    slide4 = prs.slides[3]
    for shape in slide4.shapes:
        if shape.shape_type == 13:
            slide4.shapes.add_picture('scratch/sentiment_pie_chart.png', Inches(1), Inches(1), width=Inches(6), height=Inches(6))

    # Slide 5 y 6 (como estaban antes)
    slide5 = prs.slides[4]
    for shape in slide5.shapes:
        if shape.has_text_frame and "NUMB_PRENSA" in shape.text:
            report.set_text_style(shape, str(platform_counts.get('Prensa Digital', 0)), font_size=Pt(28))
    try:
        report.add_dataframe_as_table(slide5, top_influencers_prensa, Inches(2.65), Inches(2), Inches(8), Inches(4))
    except Exception as e:
        print("Error al añadir tabla en slide5:", e)

    slide6 = prs.slides[5]
    for shape in slide6.shapes:
        if shape.has_text_frame and "NUMB_REDES" in shape.text:
            report.set_text_style(shape, str(platform_counts.get('Redes Sociales', 0)), font_size=Pt(28))
    try:
        report.add_dataframe_as_table(slide6, top_influencers_redes_posts, Inches(0.56), Inches(2), Inches(7), Inches(4))
        report.add_dataframe_as_table(slide6, top_influencers_redes_reach, Inches(8), Inches(2), Inches(5), Inches(4))
    except Exception as e:
        print("Error en slide6:", e)

    safe_title = secure_filename(report_title) if report_title else f"Reporte_{unique_id}"
    pptx_filename = f"{safe_title}.pptx"
    pptx_path = os.path.join(app.config['UPLOAD_FOLDER'], pptx_filename)
    prs.save(pptx_path)

    zip_filename = f"{safe_title}.zip"
    zip_path = os.path.join(app.config['UPLOAD_FOLDER'], zip_filename)
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        zipf.write(pptx_path, arcname=pptx_filename)
        zipf.write(processed_csv_path, arcname=os.path.basename(processed_csv_path))

    new_report = Report(
        filename=zip_filename,
        user_id=current_user.id,
        title=report_title,
        description=description
    )
    db.session.add(new_report)
    db.session.commit()

    return zip_path

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
    app.register_blueprint(auth)
    app.run(debug=True, host='0.0.0.0', port=port)