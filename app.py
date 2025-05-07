import os
import uuid
import zipfile
import shutil
import pandas as pd
from datetime import datetime
from flask import Flask, render_template, request, send_file, redirect, url_for, abort, after_this_request, session
from flask_login import LoginManager, login_required, current_user
from werkzeug.utils import secure_filename
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
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

@app.route('/menu')
@login_required
def menu():
    return render_template('menu.html')

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

        unique_id = f"{current_user.id}_{uuid.uuid4().hex[:6]}"
        csv_filename = secure_filename(csv_file.filename)
        temp_csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{unique_id}_{csv_filename}")
        csv_file.save(temp_csv_path)

        session['csv_temp_path'] = temp_csv_path
        session['wordcloud_temp_path'] = None
        session['report_title'] = report_title
        session['description'] = description

        if wordcloud_file and wordcloud_file.filename.endswith('.png'):
            temp_wordcloud_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{unique_id}_Wordcloud.png")
            wordcloud_file.save(temp_wordcloud_path)
            session['wordcloud_temp_path'] = temp_wordcloud_path

        return redirect(url_for('vista_previa'))

    return render_template('index.html')

@app.route('/vista-previa')
@login_required
def vista_previa():
    temp_csv_path = session.get('csv_temp_path')
    if not temp_csv_path or not os.path.exists(temp_csv_path):
        return redirect(url_for('index'))

    try:
        df = pd.read_csv(temp_csv_path, encoding='utf-16', sep='\t')
        if 'Hit Sentence' not in df.columns or 'Sentiment' not in df.columns:
            return render_template('error.html', title="Columnas faltantes", message="El archivo debe contener las columnas 'Hit Sentence' y 'Sentiment'.")

        df = df[~df['Hit Sentence'].str.startswith(('RT ', 'QT '), na=False)]
        preview_data = df[['Hit Sentence', 'Sentiment']].head(10).to_dict(orient='records')
        return render_template('vista_previa.html', preview_data=preview_data)

    except Exception as e:
        print("Error al cargar CSV para vista previa:", e)
        return render_template('error.html', title="Error de lectura", message="Hubo un problema al procesar el archivo CSV.")

def add_sentiment_card(slide, mention, top_position, border_color):
    # Estilo de texto (puedes modificar aquí)
    font_name = 'Calibri'
    font_size = Pt(12)
    label_color = RGBColor(80, 80, 80)
    text_color = RGBColor(0, 0, 0)

    # Crear shape
    left = Inches(0.5)
    top = Inches(top_position)
    width = Inches(9)
    height = Inches(2.2)
    card = slide.shapes.add_shape(
        autoshape_type_id=1,  # Rectángulo redondeado
        left=left,
        top=top,
        width=width,
        height=height
    )

    # Borde de color por sentimiento
    border_rgb = {
        "Positivo": RGBColor(40, 167, 69),    # Verde
        "Neutral": RGBColor(108, 117, 125),   # Gris
        "Negativo": RGBColor(220, 53, 69)     # Rojo
    }.get(mention['Sentiment'], border_color)

    card.line.color.rgb = border_rgb
    card.fill.background()

    # Texto dentro del card
    tf = card.text_frame
    tf.clear()

    # Fila de datos izquierda
    left_text = "\n".join([
        f"Influencer: {mention.get('Influencer', '')}",
        f"Source: {mention.get('Source', '')}",
        f"Hit Sentence: {mention.get('Hit Sentence', '')}",
        f"URL: {mention.get('URL', '')}",
        f"Reach: {mention.get('Reach', '')}"
    ])

    # Fila de datos derecha
    right_text = "\n".join([
        f"Fecha: {mention.get('Alternate Date Format', '')}",
        f"Hora: {mention.get('Time', '')}",
        f"Sentiment: {mention.get('Sentiment', '')}"
    ])

    # Añadir dos párrafos: izquierda y derecha
    p_left = tf.add_paragraph()
    p_left.text = left_text
    p_left.font.name = font_name
    p_left.font.size = font_size
    p_left.font.color.rgb = text_color

    p_right = tf.add_paragraph()
    p_right.text = right_text
    p_right.alignment = 2  # derecha
    p_right.font.name = font_name
    p_right.font.size = font_size
    p_right.font.color.rgb = text_color

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
    # Añadir gráfico de pastel
    for shape in slide4.shapes:
        if shape.shape_type == 13:
            slide4.shapes.add_picture('scratch/sentiment_pie_chart.png', Inches(1), Inches(1), width=Inches(6), height=Inches(6))

    # Añadir tarjetas de sentimientos
    sentiments = ['Positivo', 'Neutral', 'Negativo']
    colors = {
        'Positivo': RGBColor(40, 167, 69),
        'Neutral': RGBColor(108, 117, 125),
        'Negativo': RGBColor(220, 53, 69)
    }

    top_base = 0.5
    for idx, sentiment in enumerate(sentiments):
        match = df_cleaned[df_cleaned['Sentiment'] == sentiment].head(1)
        if not match.empty:
            add_sentiment_card(slide4, match.iloc[0], top_base + idx * 2.4, colors[sentiment])

    # Slide 5 y 6
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
    app.register_blueprint(auth)
    app.run(debug=True, host='0.0.0.0', port=port)