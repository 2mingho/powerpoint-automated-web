import shutil
import os
import uuid
import zipfile
from datetime import datetime
from flask import Flask, render_template, request, send_file
from werkzeug.utils import secure_filename
from pptx import Presentation
from pptx.util import Inches, Pt
import calculation as report

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'scratch'

# Crear la carpeta scratch si no existe
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

PPTX_TEMPLATE_PATH = "powerpoints/Reporte_plantilla.pptx"

# ─────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────
@app.route('/', methods=['GET', 'POST'])
def index():
    clean_scratch_folder()

    if request.method == 'POST':
        csv_file = request.files.get('csv_file')
        wordcloud_file = request.files.get('wordcloud_file')

        if not csv_file or not csv_file.filename.endswith('.csv'):
            return "Archivo CSV no válido.", 400

        unique_id = uuid.uuid4().hex[:6]
        csv_filename = secure_filename(csv_file.filename)
        csv_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{unique_id}_{csv_filename}")
        csv_file.save(csv_path)

        if wordcloud_file and wordcloud_file.filename.endswith('.png'):
            wordcloud_path = os.path.join(app.config['UPLOAD_FOLDER'], 'Wordcloud.png')
            wordcloud_file.save(wordcloud_path)
        else:
            wordcloud_path = None

        try:
            zip_path = process_report(csv_path, wordcloud_path, unique_id)
        except Exception as e:
            return f"Error al generar el reporte: {e}", 500

        return render_template('download.html', zip_path=zip_path)

    return render_template('index.html')

# ─────────────────────────────────────────────────────────────
def process_report(csv_path, wordcloud_path, unique_id):
    df_cleaned = report.load_and_clean_data(csv_path)
    df_cleaned['Influencer'] = df_cleaned.apply(report.update_influencer, axis=1)
    df_cleaned['Sentiment'] = df_cleaned.apply(report.update_sentiment, axis=1)

    total_mentions, count_of_authors, estimated_reach = report.calculate_summary_metrics(df_cleaned)
    formatted_estimated_reach = estimated_reach
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
    client_name = os.path.basename(csv_path).split()[0]

    prs = Presentation(PPTX_TEMPLATE_PATH)

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
                "EST_REACH": formatted_estimated_reach
            }.items():
                if key in shape.text:
                    report.set_text_style(shape, str(value), font_size=Pt(22), center=True)
        elif shape.shape_type == 13:
            slide2.shapes.add_picture('scratch/convEvolution.png', Inches(0.2), Inches(1.2), width=Inches(10.46), height=Inches(5.63))

    # Slide 3
    slide3 = prs.slides[2]
    for shape in slide3.shapes:
        if shape.has_text_frame and "TOP_NEWS" in shape.text:
            report.set_text_style(shape, "\n".join(top_sentences), 'Effra Light', Pt(12), False)
    try:
        slide3.shapes.add_picture('scratch/Wordcloud.png', Inches(7.5), Inches(3.5), width=Inches(4.2), height=Inches(2.66))
    except Exception as e:
        print("Error al insertar Wordcloud:", e)

    # Slide 4
    slide4 = prs.slides[3]
    for shape in slide4.shapes:
        if shape.shape_type == 13:
            slide4.shapes.add_picture('scratch/sentiment_pie_chart.png', Inches(1), Inches(1), width=Inches(6), height=Inches(6))

    # Slide 5
    slide5 = prs.slides[4]
    for shape in slide5.shapes:
        if shape.has_text_frame and "NUMB_PRENSA" in shape.text:
            report.set_text_style(shape, str(platform_counts.get('Prensa Digital', 0)), font_size=Pt(28))
    try:
        report.add_dataframe_as_table(slide5, top_influencers_prensa, Inches(2.65), Inches(2), Inches(8), Inches(4))
    except Exception as e:
        print("Error al añadir tabla en slide5:", e)

    # Slide 6
    slide6 = prs.slides[5]
    for shape in slide6.shapes:
        if shape.has_text_frame and "NUMB_REDES" in shape.text:
            report.set_text_style(shape, str(platform_counts.get('Redes Sociales', 0)), font_size=Pt(28))
    try:
        report.add_dataframe_as_table(slide6, top_influencers_redes_posts, Inches(0.56), Inches(2), Inches(7), Inches(4))
    except Exception as e:
        print("Error al añadir tabla en slide6 (posts):", e)
    try:
        report.add_dataframe_as_table(slide6, top_influencers_redes_reach, Inches(8), Inches(2), Inches(5), Inches(4))
    except Exception as e:
        print("Error al añadir tabla en slide6 (reach):", e)

    # Guardar PowerPoint
    pptx_filename = f"Reporte_{current_date_file_name}_{unique_id}.pptx"
    pptx_path = os.path.join(app.config['UPLOAD_FOLDER'], pptx_filename)
    prs.save(pptx_path)

    # Crear ZIP
    zip_filename = f"Reporte_{unique_id}.zip"
    zip_path = os.path.join(app.config['UPLOAD_FOLDER'], zip_filename)
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        zipf.write(pptx_path, arcname=pptx_filename)
        zipf.write(processed_csv_path, arcname=os.path.basename(processed_csv_path))

    return zip_path

# ─────────────────────────────────────────────────────────────
@app.route('/download/<path:filename>')
def download_file(filename):
    response = send_file(filename, as_attachment=True)
    clean_scratch_folder()
    return response

# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host='0.0.0.0', port=port)
