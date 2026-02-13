import os
import uuid
import zipfile
import shutil
import json
from datetime import datetime
import functools
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for, abort, after_this_request, flash
from flask_login import current_user, login_required
from classifier import classify_mentions
from werkzeug.utils import secure_filename
from pptx import Presentation
from pptx.util import Inches, Pt
from babel.dates import format_datetime
from sqlalchemy import inspect, text
from dotenv import load_dotenv

from auth import auth
from admin import admin_bp, log_activity
from extensions import db, login_manager
from models import User, Report, ActivityLog
import calculation as report
from groq_analysis import construir_prompt, llamar_groq, extraer_json, formatear_analisis_social_listening
import ppt_engine
from csv_analysis import analyze_csv, generate_summary_csv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'scratch'

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
if not app.config['SECRET_KEY']:
    raise RuntimeError("SECRET_KEY must be set in .env file. Generate one with: python -c 'import secrets; print(secrets.token_hex(32))'")

app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload limit
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'

db.init_app(app)
login_manager.init_app(app)

# Registrar blueprints
app.register_blueprint(auth)
app.register_blueprint(admin_bp)

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
    """Clean only old files (>1 hour) to prevent race conditions (P6)"""
    folder = app.config['UPLOAD_FOLDER']
    try:
        import time
        current_time = time.time()
        one_hour_ago = current_time - 3600
        
        for file in os.listdir(folder):
            file_path = os.path.join(folder, file)
            try:
                # Only delete files/folders older than 1 hour
                if os.path.getmtime(file_path) < one_hour_ago:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
            except Exception:
                continue
    except Exception as e:
        app.logger.error(f"Error al limpiar la carpeta scratch: {e}")


# ─────────────────────────────────────────────────────────────
# Tool access decorator
# ─────────────────────────────────────────────────────────────

def tool_required(tool_key):
    """Decorator: blocks access if user lacks permission for *tool_key*."""
    def wrapper(f):
        @functools.wraps(f)
        @login_required
        def decorated(*args, **kwargs):
            if not current_user.has_tool_access(tool_key):
                flash('No tienes permiso para acceder a esta herramienta.', 'error')
                return redirect(url_for('menu'))
            return f(*args, **kwargs)
        return decorated
    return wrapper


# Inject has_tool_access into templates
@app.context_processor
def inject_tool_access():
    def _has_tool_access(tool_key):
        if current_user.is_authenticated:
            return current_user.has_tool_access(tool_key)
        return False
    return dict(has_tool_access=_has_tool_access)


@app.route('/menu')
@login_required
def menu():
    return render_template('menu.html')


@app.route('/', methods=['GET', 'POST'])
@tool_required('reports')
def index():
    # Only clean old files, not all files (P6)
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
            log_activity('generate_report', f'Reporte generado: {report_title or csv_filename} (plantilla: {selected_template})')
        except Exception as e:
            app.logger.error(f"Error generando el reporte: {e}")
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

    # --- OPTIMIZED: Single-pass placeholder indexing (P3) ---
    # Build index once instead of scanning slides multiple times
    placeholder_index = {}
    for slide in prs.slides:
        for shape in slide.shapes:
            try:
                if shape.has_text_frame and shape.text.strip():
                    placeholder_index[shape.text.strip()] = (slide, shape)
            except Exception:
                continue

    def find_shape_for_key(key):
        """Fast lookup using pre-built index"""
        return placeholder_index.get(key, (None, None))

    # Reemplazo de textos genéricos
    text_mapping = {
        "REPORT_CLIENT": client_name,
        "REPORT_DATE": current_date,
        "NUMB_MENTIONS": str(total_mentions),
        "NUMB_ACTORS": str(count_of_authors),
        "EST_REACH": estimated_reach
    }

    # Apply text replacements using index
    found_text_keys = set()
    for key, value in text_mapping.items():
        slide, shape = find_shape_for_key(key)
        if shape:
            try:
                report.set_text_style(shape, str(value), 'Effra Heavy', Pt(28), 
                                     False if key not in ("NUMB_MENTIONS", "NUMB_ACTORS", "EST_REACH") else True)
                found_text_keys.add(key)
            except Exception:
                pass
    
    for key in text_mapping.keys():
        if key not in found_text_keys:
            missing_fields.append(key)

    # Charts / imágenes: buscar placeholder y añadir imagen en la ubicación del placeholder
    def place_image_at_placeholder(key, image_path, default_size=None):
        slide, shape = find_shape_for_key(key)
        if slide and shape:
            try:
                left = shape.left
                top = shape.top
                width = shape.width
                height = shape.height
                # eliminar texto para evitar superposición
                try:
                    shape.text = ""
                except Exception:
                    pass
                if default_size:
                    width, height = default_size
                slide.shapes.add_picture(image_path, left, top, width=width, height=height)
                return True
            except Exception:
                return False
        return False

    # Conversación (chart)
    conv_added = place_image_at_placeholder('CONVERSATION_CHART', 'scratch/convEvolution.png', default_size=(Inches(9.55), Inches(5.14)))
    if not conv_added:
        missing_fields.append('CONVERSATION_CHART')

    # Sentiment pie
    sent_added = place_image_at_placeholder('SENTIMENT_PIE', 'scratch/sentiment_pie_chart.png', default_size=(Inches(6), Inches(6)))
    if not sent_added:
        missing_fields.append('SENTIMENT_PIE')

    # Wordcloud
    wc_added = False
    if wordcloud_path and os.path.exists(wordcloud_path):
        wc_added = place_image_at_placeholder('WORDCLOUD', wordcloud_path, default_size=(Inches(4.2), Inches(2.66)))
    if not wc_added:
        missing_fields.append('WORDCLOUD')

    # Top news (texto grande)
    topnews_slide, topnews_shape = find_shape_for_key('TOP_NEWS')
    if topnews_shape:
        try:
            report.set_text_style(topnews_shape, "\n".join(top_sentences), 'Effra Light', Pt(12), False)
        except Exception:
            missing_fields.append('TOP_NEWS')
    else:
        missing_fields.append('TOP_NEWS')

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

    analisis_slide, analisis_shape = find_shape_for_key('CONVERSATION_ANALISIS')
    if analisis_shape:
        try:
            report.set_text_style(analisis_shape, analisis_texto, 'Effra Light', Pt(11), False)
        except Exception:
            missing_fields.append('CONVERSATION_ANALISIS')
    else:
        missing_fields.append('CONVERSATION_ANALISIS')

    # KPI NUMB_PRENSA / NUMB_REDES and tables: localizar placeholder y ubicar tabla
    prensa_shape_key = 'NUMB_PRENSA'
    prensa_slide, prensa_shape = find_shape_for_key(prensa_shape_key)
    if prensa_shape:
        try:
            report.set_text_style(prensa_shape, str(platform_counts.get('Prensa Digital', 0)), font_size=Pt(28))
        except Exception:
            missing_fields.append(prensa_shape_key)
    else:
        missing_fields.append(prensa_shape_key)

    try:
        table_added = False
        slide_for_table, shape_for_table = find_shape_for_key('TOP_INFLUENCERS_PRENSA_TABLE')
        if slide_for_table and shape_for_table:
            left, top, width, height = shape_for_table.left, shape_for_table.top, shape_for_table.width, shape_for_table.height
            try:
                report.add_dataframe_as_table(slide_for_table, top_influencers_prensa, left, top, width, height)
                table_added = True
            except Exception:
                table_added = False
        if not table_added:
            missing_fields.append('TOP_INFLUENCERS_PRENSA_TABLE')
    except Exception:
        missing_fields.append('TOP_INFLUENCERS_PRENSA_TABLE')

    redes_shape_key = 'NUMB_REDES'
    redes_slide, redes_shape = find_shape_for_key(redes_shape_key)
    if redes_shape:
        try:
            report.set_text_style(redes_shape, str(platform_counts.get('Redes Sociales', 0)), font_size=Pt(28))
        except Exception:
            missing_fields.append(redes_shape_key)
    else:
        missing_fields.append(redes_shape_key)

    # Two tables for redes (posts and reach)
    try:
        table1_added = False
        slide_t1, shape_t1 = find_shape_for_key('TOP_INFLUENCERS_REDES_POSTS_TABLE')
        if slide_t1 and shape_t1:
            try:
                report.add_dataframe_as_table(slide_t1, top_influencers_redes_posts, shape_t1.left, shape_t1.top, shape_t1.width, shape_t1.height)
                table1_added = True
            except Exception:
                table1_added = False
        if not table1_added:
            missing_fields.append('TOP_INFLUENCERS_REDES_POSTS_TABLE')
    except Exception:
        missing_fields.append('TOP_INFLUENCERS_REDES_POSTS_TABLE')

    try:
        table2_added = False
        slide_t2, shape_t2 = find_shape_for_key('TOP_INFLUENCERS_REDES_REACH_TABLE')
        if slide_t2 and shape_t2:
            try:
                report.add_dataframe_as_table(slide_t2, top_influencers_redes_reach, shape_t2.left, shape_t2.top, shape_t2.width, shape_t2.height)
                table2_added = True
            except Exception:
                table2_added = False
        if not table2_added:
            missing_fields.append('TOP_INFLUENCERS_REDES_REACH_TABLE')
    except Exception:
        missing_fields.append('TOP_INFLUENCERS_REDES_REACH_TABLE')

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
    # Path sanitization (S7)
    safe_filename = secure_filename(filename)
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(full_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {filename}")
        abort(403)
    
    if not os.path.exists(full_path):
        abort(404)

    @after_this_request
    def cleanup(response):
        clean_scratch_folder()
        return response

    log_activity('download_report', f'Descarga: {safe_filename}')
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


@app.route('/clasificacion', methods=['GET', 'POST'])
@tool_required('classification')
def clasificacion():
    if request.method == 'POST':
        # 1. Obtener archivo, reglas y valor por defecto
        file = request.files.get('csv_file')
        rules_str = request.form.get('rules')
        default_val = request.form.get('default_val', 'Sin Clasificar')
        use_keywords = request.form.get('use_keywords') == 'true'
        
        if not file or not rules_str:
            flash("Archivo o reglas no proporcionados.", "error")
            return redirect(url_for('clasificacion'))
        
        try:
            rules = json.loads(rules_str)
        except json.JSONDecodeError:
            flash("Error al procesar las reglas de clasificación.", "error")
            return redirect(url_for('clasificacion'))
            
        # 2. Guardar archivo temporal
        unique_id = str(uuid.uuid4())
        filename = f"{unique_id}_{file.filename}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # 3. Clasificar
        try:
            print(f"DEBUG: Iniciando clasificación con default_val='{default_val}', use_keywords={use_keywords}")
            df_classified = classify_mentions(file_path, rules, default_val=default_val, use_keywords=use_keywords)
            
            # 4. Calcular Estadísticas (Distribución e Insights) - Optimized (P2)
            stats = {}
            if df_classified is not None and not df_classified.empty:
                # Vectorized approach: much faster than iterrows()
                grouped = df_classified.groupby(['Categoria', 'Tematica']).size().reset_index(name='count')
                
                for _, row in grouped.iterrows():
                    cat = str(row['Categoria'])
                    tem = str(row['Tematica'])
                    count = row['count']
                    
                    if cat not in stats:
                        stats[cat] = {"total": 0, "tematicas": {}}
                    
                    stats[cat]["total"] += count
                    stats[cat]["tematicas"][tem] = count
            
            # Insights adicionales para el visual
            top_category = "N/A"
            max_val = -1
            for cat, data in stats.items():
                if cat != default_val and data['total'] > max_val:
                    max_val = data['total']
                    top_category = cat

            # 5. Guardar resultado (CSV para descarga)
            output_filename = f"Clasificado_{file.filename}"
            output_path = os.path.join(app.config['UPLOAD_FOLDER'], f"classified_{unique_id}.csv")
            df_classified.to_csv(output_path, sep='\t', encoding='utf-16', index=False)

            log_activity('classify_data', f'Clasificación: {file.filename} ({len(df_classified)} filas, {len(stats)} categorías)')
            
            return jsonify({
                "success": True,
                "download_url": url_for('download_classified', file_id=unique_id, original_name=output_filename),
                "stats": stats,
                "total_rows": len(df_classified),
                "insights": {
                    "top_category": top_category,
                    "top_count": max_val if max_val != -1 else 0
                }
            })
            
        except Exception as e:
            app.logger.error(f"Error en clasificación: {e}")
            return jsonify({"success": False, "error": "Error procesando la clasificación. Por favor intenta nuevamente."}), 500
            
    return render_template('clasificacion.html')

@app.route('/download_classified/<file_id>/<original_name>')
@login_required
def download_classified(file_id, original_name):
    # Path sanitization (S7)
    safe_id = secure_filename(file_id)
    safe_name = secure_filename(original_name)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"classified_{safe_id}.csv")
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(file_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {file_id}")
        abort(403)
    
    @after_this_request
    def cleanup(response):
        try:
            if os.path.exists(file_path):
                # Opcional: borrar archivo después de descarga
                # os.remove(file_path) 
                pass
        except Exception as e:
            app.logger.error(f"Error limpiando archivo clasificado: {e}")
        return response

    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=safe_name)
    else:
        abort(404)


@app.route('/union')
@tool_required('file_merge')
def union_archivos():
    return render_template('union.html')


@app.route('/analisis-csv', methods=['GET', 'POST'])
@tool_required('csv_analysis')
def analisis_csv():
    if request.method == 'POST':
        # Get file and parameters
        file = request.files.get('csv_file')
        encoding = request.form.get('encoding', 'utf-8')
        separator = request.form.get('separator', ',')
        
        if not file:
            return jsonify({'success': False, 'error': 'No se proporcionó ningún archivo'}), 400
        
        # Save file temporarily
        unique_id = str(uuid.uuid4())
        filename = f"{unique_id}_{secure_filename(file.filename)}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        try:
            # Run analysis
            result = analyze_csv(file_path, encoding, separator)

            if result['success']:
                log_activity('csv_analysis', f'Análisis CSV: {file.filename}')
                # Generate summary CSV for download
                summary_filename = f"summary_{unique_id}.csv"
                summary_path = os.path.join(app.config['UPLOAD_FOLDER'], summary_filename)
                generate_summary_csv(result, summary_path)
                
                # Add download URL to result
                result['download_url'] = url_for('download_csv_summary', file_id=unique_id)
                result['original_filename'] = file.filename
                
                return jsonify(result)
            else:
                return jsonify(result), 400
                
        except Exception as e:
            app.logger.error(f"Error en análisis CSV: {e}")
            return jsonify({
                'success': False,
                'error': f'Error procesando el archivo: {str(e)}'
            }), 500
        finally:
            # Clean up uploaded file
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    app.logger.error(f"Error eliminando archivo temporal: {e}")
    
    return render_template('analisis_csv.html')


@app.route('/analisis-csv/download/<file_id>')
@login_required
def download_csv_summary(file_id):
    # Path sanitization
    safe_id = secure_filename(file_id)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"summary_{safe_id}.csv")
    
    # Verify path is within UPLOAD_FOLDER
    if not os.path.abspath(file_path).startswith(os.path.abspath(app.config['UPLOAD_FOLDER'])):
        app.logger.warning(f"Path traversal attempt: {file_id}")
        abort(403)
    
    @after_this_request
    def cleanup(response):
        try:
            if os.path.exists(file_path):
                # Delete file after download
                os.remove(file_path)
        except Exception as e:
            app.logger.error(f"Error limpiando archivo de resumen: {e}")
        return response
    
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name=f"analisis_resumen_{safe_id}.csv")
    else:
        abort(404)

@app.route('/upload_csv', methods=['POST'])
@login_required
def upload_csv():
    if 'csv_file' not in request.files:
        flash('No se seleccionó ningún archivo')
        return redirect(url_for('index'))
    
    file = request.files['csv_file']
    
    if file.filename == '':
        flash('Nombre de archivo vacío')
        return redirect(url_for('index'))

    if file:
        try:
            upload_folder = 'scratch'
            os.makedirs(upload_folder, exist_ok=True)
            file_path = os.path.join(upload_folder, file.filename)
            file.save(file_path)
            
            # Capturamos el título del formulario HTML también
            titulo = request.form.get('report_title', 'Mi Reporte')

            report_context = report.create_report_context(
                file_path, 
                report_title=titulo
            )
            return render_template('editor.html', context=report_context)
            
        except Exception as e:
            app.logger.error(f"ERROR: {e}")
            flash(f"Error procesando el archivo: {str(e)}")
            return redirect(url_for('index'))

    return redirect(url_for('index'))


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

@app.route('/generate_pptx', methods=['POST'])
@login_required
def generate_pptx_route():
    try:
        # 1. Recibir el JSON con los datos editados
        data = request.json
        if not data:
            return "No se recibieron datos JSON", 400

        # 2. Definir rutas
        template_path = os.path.join('powerpoints', 'Reporte_plantilla.pptx') 
        
        # Verificar que la plantilla existe
        if not os.path.exists(template_path):
            return f"Error: No se encuentra la plantilla en {template_path}", 500

        filename = f"Reporte_{data['meta']['client_name']}.pptx"
        output_path = os.path.join('scratch', filename)

        # 3. Llamar al motor de generación
        ppt_engine.generate_pptx(data, template_path, output_path)

        # 4. Enviar el archivo al usuario
        return send_file(output_path, as_attachment=True, download_name=filename)

    except Exception as e:
        app.logger.error(f"ERROR GENERANDO PPT: {e}")
        return "Error generando el reporte. Por favor intenta nuevamente.", 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug_mode, host='0.0.0.0', port=port)