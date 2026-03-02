from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for, current_app
from flask_login import login_required, current_user
from extensions import db
from models import ClassificationProfile, ClassificationCategory, ClassificationTheme, ClassificationKeyword, TbInstagram, TbFacebook, TbLinkedin, TbTwitter, TbYoutube
import logging

social_etl_bp = Blueprint('social_etl', __name__, url_prefix='/social-etl')

@social_etl_bp.route('/manager')
@login_required
def manager():
    """UI for managing classification profiles."""
    return render_template('social_etl/manager.html')

# ==========================================
#  API ROUTES (JSON)
# ==========================================

@social_etl_bp.route('/api/profiles', methods=['GET'])
@login_required
def get_profiles():
    profiles = ClassificationProfile.query.all()
    data = []
    for p in profiles:
        data.append({
            'id': p.id,
            'name': p.name,
            'is_active': p.is_active,
            'created_at': p.created_at.isoformat() if p.created_at else None
        })
    return jsonify(data)

@social_etl_bp.route('/api/profiles', methods=['POST'])
@login_required
def create_profile():
    data = request.json
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    
    if ClassificationProfile.query.filter_by(name=name).first():
        return jsonify({'error': 'Profile with this name already exists'}), 400
    
    current_app.logger.info(f"Creating new profile: {name} by user {current_user.id}")
    profile = ClassificationProfile(name=name, is_active=False)
    db.session.add(profile)
    db.session.commit()
    current_app.logger.info(f"Profile created: {profile.id}")
    return jsonify({'id': profile.id, 'name': profile.name}), 201

@social_etl_bp.route('/api/profiles/<int:id>', methods=['DELETE'])
@login_required
def delete_profile(id):
    profile = ClassificationProfile.query.get_or_404(id)
    db.session.delete(profile)
    db.session.commit()
    return jsonify({'success': True})

@social_etl_bp.route('/api/profiles/<int:id>/activate', methods=['POST'])
@login_required
def activate_profile(id):
    # Deactivate all others
    ClassificationProfile.query.update({ClassificationProfile.is_active: False})
    
    profile = ClassificationProfile.query.get_or_404(id)
    profile.is_active = True
    db.session.commit()
    return jsonify({'success': True})

@social_etl_bp.route('/api/profiles/<int:id>/details', methods=['GET'])
@login_required
def get_profile_details(id):
    """Get full hierarchy for a profile."""
    profile = ClassificationProfile.query.get_or_404(id)
    
    result = {
        'id': profile.id,
        'name': profile.name,
        'categories': []
    }
    
    for cat in profile.categories:
        cat_data = {
            'id': cat.id,
            'name': cat.name,
            'themes': []
        }
        for theme in cat.themes:
            theme_data = {
                'id': theme.id,
                'name': theme.name,
                'keywords': [k.keyword for k in theme.keywords]
            }
            cat_data['themes'].append(theme_data)
        result['categories'].append(cat_data)
        
    return jsonify(result)

@social_etl_bp.route('/api/categories', methods=['POST'])
@login_required
def create_category():
    data = request.json
    profile_id = data.get('profile_id')
    name = data.get('name')
    
    profile = ClassificationProfile.query.get(profile_id)
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404
        
    category = ClassificationCategory(profile_id=profile_id, name=name)
    db.session.add(category)
    db.session.commit()
    return jsonify({'id': category.id, 'name': category.name}), 201 

@social_etl_bp.route('/api/categories/<int:id>', methods=['DELETE'])
@login_required
def delete_category(id):
    cat = ClassificationCategory.query.get_or_404(id)
    db.session.delete(cat)
    db.session.commit()
    return jsonify({'success': True})

@social_etl_bp.route('/api/themes', methods=['POST'])
@login_required
def create_theme():
    data = request.json
    category_id = data.get('category_id')
    name = data.get('name')
    
    category = ClassificationCategory.query.get(category_id)
    if not category:
        return jsonify({'error': 'Category not found'}), 404
        
    theme = ClassificationTheme(category_id=category_id, name=name)
    db.session.add(theme)
    db.session.commit()
    return jsonify({'id': theme.id, 'name': theme.name}), 201

@social_etl_bp.route('/api/themes/<int:id>', methods=['DELETE'])
@login_required
def delete_theme(id):
    theme = ClassificationTheme.query.get_or_404(id)
    db.session.delete(theme)
    db.session.commit()
    return jsonify({'success': True})

@social_etl_bp.route('/api/themes/<int:id>/keywords', methods=['POST'])
@login_required
def update_keywords(id):
    data = request.json
    keywords_list = data.get('keywords', [])
    
    theme = ClassificationTheme.query.get_or_404(id)
    
    # Replace all keywords logic (simpler than verifying diffs)
    # First delete existing
    ClassificationKeyword.query.filter_by(theme_id=id).delete()
    
    for k in keywords_list:
        if k.strip():
            new_k = ClassificationKeyword(theme_id=id, keyword=k.strip())
            db.session.add(new_k)
            
    db.session.commit()
    return jsonify({'success': True})


# ==========================================
#  ETL / INGESTION ROUTES
# ==========================================

@social_etl_bp.route('/upload')
@login_required
def upload_page():
    return render_template('social_etl/upload.html')

@social_etl_bp.route('/api/preview-columns', methods=['POST'])
@login_required
def preview_columns():
    try:
        file = request.files.get('csv_file')
        encoding = request.form.get('encoding', 'utf-8')
        separator = request.form.get('separator', ',')
        
        if not file:
            return jsonify({'error': 'No file provided'}), 400
        
        # Read just the header
        import pandas as pd
        df = pd.read_csv(file, encoding=encoding, sep=separator, nrows=0)
        return jsonify({'columns': list(df.columns)})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@social_etl_bp.route('/api/process-upload', methods=['POST'])
@login_required
def process_upload():
    try:
        # 1. Get Params
        file = request.files.get('csv_file')
        encoding = request.form.get('encoding', 'utf-8')
        separator = request.form.get('separator', ',')
        text_column = request.form.get('text_column')
        mes = request.form.get('mes')
        anio = request.form.get('anio')

        if not file or not text_column:
            current_app.logger.error("Process upload failed: Missing file or text column")
            return jsonify({'error': 'Missing file or text column'}), 400

        current_app.logger.info(f"Processing upload: {file.filename}, text_col={text_column}, encoding={encoding}")

        # 2. Process Service
        from services.social_etl_service import process_social_csv
        df = process_social_csv(file, encoding, separator, text_column, mes, anio)
        
        current_app.logger.info(f"CSV processed successfully. Rows: {len(df)}")
        
        # 3. Store in Session or Temp File for Validation
        # Since DataFrames can be large, temp file + ID is better than session
        import uuid
        import os
        from app import app
        
        temp_id = str(uuid.uuid4())
        filename = f"staged_{temp_id}.pkl" # Pickle preserves types/dates
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        df.to_pickle(temp_path)
        
        # 4. Return Redirect URL to Validation Page
        return jsonify({
            'success': True,
            'redirect_url': url_for('social_etl.validation_page', staged_id=temp_id)
        })

    except Exception as e:
        current_app.logger.error(f"API Error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@social_etl_bp.route('/validation/<staged_id>')
@login_required
def validation_page(staged_id):
    # Pass the ID to the template, enabling it to fetch data via API
    return render_template('social_etl/validation.html', staged_id=staged_id)

@social_etl_bp.route('/api/validation/<staged_id>/data', methods=['GET'])
@login_required
def get_staged_data(staged_id):
    # Fetch data and return JSON for the table
    try:
        import os
        import pandas as pd
        from app import app
        
        filename = f"staged_{staged_id}.pkl"
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(path):
            return jsonify({'error': 'Session expired or file not found'}), 404
            
        df = pd.read_pickle(path)
        
        # Convert Dates to string for JSON serialization
        # Replace NaNs
        df_json = df.fillna("").astype(str).to_dict(orient='records')
        
        return jsonify({
            'data': df_json,
            'columns': list(df.columns),
            'stats': {
                'total': len(df),
                'unclassified': len(df[df['Categoria'] == 'Sin Clasificar'])
            }
        })
    except Exception as e:
        current_app.logger.error(f"API Error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@social_etl_bp.route('/api/validation/<staged_id>/reclassify', methods=['POST'])
@login_required
def reclassify_data(staged_id):
    try:
        import os
        import pandas as pd
        from app import app
        from services.social_etl_service import get_active_profile_rules
        
        filename = f"staged_{staged_id}.pkl"
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(path):
            return jsonify({'error': 'Session expired'}), 404
            
        df = pd.read_pickle(path)
        
        # Re-run strict classification logic (simplified version of process_social_csv step 6)
        current_app.logger.info(f"Reclassifying staged data: {staged_id}")
        rules = get_active_profile_rules()
        df['Hit Sentence Lower'] = df['Hit Sentence'].str.lower()
        
        # Reset current classification?
        # Maybe user wants to KEEP manual edits? We don't support manual edits yet.
        # So full reset is expected.
        df['Categoria'] = 'Sin Clasificar'
        df['Tematica'] = 'Sin Clasificar'
        
        for category_rule in rules:
            category_name = category_rule['category']
            for tematica_rule in category_rule['tematicas']:
                tematica_name = tematica_rule['name']
                keywords = [k.lower() for k in tematica_rule['keywords']]
                
                if not keywords: continue
                mask = df['Hit Sentence Lower'].apply(lambda s: any(k in s for k in keywords))
                
                df.loc[mask & (df['Tematica'] == 'Sin Clasificar'), 'Tematica'] = tematica_name
                df.loc[mask & (df['Categoria'] == 'Sin Clasificar'), 'Categoria'] = category_name
                
        df = df.drop(columns=['Hit Sentence Lower'], errors='ignore')
        
        # Save back
        df.to_pickle(path)
        
        return jsonify({'success': True})
        
    except Exception as e:
        current_app.logger.error(f"API Error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@social_etl_bp.route('/api/validation/<staged_id>/save', methods=['POST'])
@login_required
def save_staged_data(staged_id):
    try:
        data = request.json
        platform = data.get('platform')
        
        if not platform:
            return jsonify({'error': 'Platform is required'}), 400
            
        import os
        import pandas as pd
        from app import app
        from services.social_etl_service import save_dataframe_to_platform
        
        filename = f"staged_{staged_id}.pkl"
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(path):
            return jsonify({'error': 'Session expired'}), 404
            
        df = pd.read_pickle(path)
        
        current_app.logger.info(f"Saving staged data {staged_id} to {platform}")
        count = save_dataframe_to_platform(df, platform)
        current_app.logger.info(f"Successfully saved {count} rows to {platform}")
        
        # Cleanup
        try:
            os.remove(path)
        except: pass
        
        return jsonify({'success': True, 'inserted_count': count})
        
    except Exception as e:
        current_app.logger.error(f"API Error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ==========================================
#  DASHBOARD ROUTES
# ==========================================

@social_etl_bp.route('/dashboard')
@login_required
def dashboard():
    return render_template('social_etl/dashboard.html', current_year=2025)

@social_etl_bp.route('/api/dashboard/data', methods=['POST'])
@login_required
def get_dashboard_data_api():
    try:
        filters = request.json or {}
        
        from services.social_etl_service import get_dashboard_metrics
        data = get_dashboard_metrics(filters)
        
        return jsonify(data)
    except Exception as e:
        current_app.logger.error(f"Dashboard error: {str(e)}", exc_info=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
