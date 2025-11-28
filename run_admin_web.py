"""
Flask backend API for the Admin Interface
Serves the HTML UI and provides REST API endpoints for:
- Uploading and managing documents
- Viewing and resolving user reports
- System statistics
- User authentication
"""
import os
from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_cors import CORS
from werkzeug.utils import secure_filename
from rag_chatbot.pipeline import LocalRAGPipeline
from rag_chatbot.database import document_manager, report_manager
from rag_chatbot.auth import AuthManager
from pathlib import Path
from functools import wraps

# Get absolute path to UI directory
UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'UI')
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'data')
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'knowledge_base.db')

app = Flask(__name__, 
            template_folder=UI_DIR,
            static_folder=UI_DIR,
            static_url_path='')
CORS(app)

# Ensure data directory exists
Path(DATA_DIR).mkdir(parents=True, exist_ok=True)

# Determine which LLM to use based on environment variable
# Options: "gemini", "openrouter", "ollama" (default)
llm_provider = os.environ.get('LLM_PROVIDER', 'ollama').lower()

# Initialize pipeline and auth
if llm_provider == 'gemini':
    gemini_api_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable required when LLM_PROVIDER=gemini")
    print("=" * 80)
    print("🚀 Using Gemini API for fast responses (2-5 seconds)")
    print("=" * 80)
    pipeline = LocalRAGPipeline(use_gemini=True, gemini_api_key=gemini_api_key)
elif llm_provider == 'openrouter':
    print("=" * 80)
    print("🚀 Using OpenRouter API")
    print("=" * 80)
    # OpenRouter logic would go here if implemented
    pipeline = LocalRAGPipeline()
else:
    print("=" * 80)
    print("🚀 Using Ollama (local LLM)")
    print("=" * 80)
    pipeline = LocalRAGPipeline()

auth_manager = AuthManager(DB_PATH)
print("Pipeline initialized")
print("Authentication system initialized")

# Allowed file extensions
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.txt', '.md', '.markdown'}

def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


# Authentication decorator
def require_auth(role=None):
    """Decorator to require authentication and optionally check role"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Get token from Authorization header or cookie
            auth_header = request.headers.get('Authorization')
            token = None
            
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
            else:
                token = request.cookies.get('session_token')
            
            if not token:
                return jsonify({'success': False, 'error': 'Authentication required'}), 401
            
            # Validate session
            is_valid, user_info = auth_manager.validate_session(token)
            
            if not is_valid:
                return jsonify({'success': False, 'error': 'Invalid or expired session'}), 401
            
            # Check role if specified
            if role and user_info['role'] != role:
                return jsonify({'success': False, 'error': 'Insufficient permissions'}), 403
            
            # Add user info to request
            request.user = user_info
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator


@app.route('/')
def index():
    """Serve the admin interface (requires authentication)"""
    # Check if user is authenticated
    token = request.cookies.get('session_token')
    if not token:
        return redirect('/login')
    
    is_valid, user_info = auth_manager.validate_session(token)
    if not is_valid:
        return redirect('/login')
    
    # Check if user is admin
    if user_info['role'] != 'admin':
        # Get the host from request to redirect to user web on same server
        host = request.host.rsplit(':', 1)[0]  # Remove port if present
        return redirect(f'http://{host}:7861')  # Redirect regular users to user interface
    
    # Send response with no-cache headers to prevent back button issues
    response = send_from_directory(UI_DIR, 'admin_index.html')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response



@app.route('/admin')
def admin_page():
    """Serve the admin interface (requires admin authentication)"""
    # Check if user is authenticated
    token = request.cookies.get('session_token')
    if not token:
        return redirect('/login')
    
    is_valid, user_info = auth_manager.validate_session(token)
    if not is_valid:
        return redirect('/login')
    
    # Check if user is admin
    if user_info['role'] != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    
    # Send response with no-cache headers to prevent back button issues
    response = send_from_directory(UI_DIR, 'admin_index.html')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/login')
def login_page():
    """Serve the login page"""
    # If already logged in, redirect to appropriate page based on current server
    token = request.cookies.get('session_token')
    if token:
        is_valid, user_info = auth_manager.validate_session(token)
        if is_valid:
            if user_info['role'] == 'admin':
                # Admin already logged in on admin web, show admin interface
                return redirect('/admin')
            else:
                # Regular user should go to user web
                host = request.host.rsplit(':', 1)[0]
                return redirect(f'http://{host}:7861/')
    
    return send_from_directory(UI_DIR, 'login.html')


@app.route('/signup')
def signup_page():
    """Serve the signup page"""
    return send_from_directory(UI_DIR, 'signup.html')


@app.route('/<path:filename>')
def serve_file(filename):
    """Serve static files (CSS, JS)"""
    return send_from_directory(UI_DIR, filename)


# ============================================================
# Authentication API Endpoints
# ============================================================

@app.route('/api/auth/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.json
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        full_name = data.get('full_name')
        
        success, message, user_id = auth_manager.register_user(
            username=username,
            email=email,
            password=password,
            full_name=full_name,
            role='user'  # Default role is user
        )
        
        if success:
            return jsonify({
                'success': True,
                'message': message,
                'user_id': user_id
            })
        else:
            return jsonify({
                'success': False,
                'error': message
            }), 400
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate user and create session"""
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        # Get client info
        ip_address = request.remote_addr
        user_agent = request.headers.get('User-Agent')
        
        success, message, session_token, user_info = auth_manager.login(
            username=username,
            password=password,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        if success:
            response = jsonify({
                'success': True,
                'message': message,
                'session_token': session_token,
                'user': user_info
            })
            
            # Set session cookie
            response.set_cookie('session_token', session_token, 
                              max_age=24*60*60,  # 24 hours
                              httponly=True,
                              samesite='Lax')
            
            return response
        else:
            return jsonify({
                'success': False,
                'error': message
            }), 401
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Logout user and invalidate session"""
    try:
        auth_header = request.headers.get('Authorization')
        token = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        else:
            token = request.cookies.get('session_token')
        
        if token:
            auth_manager.logout(token)
        
        response = jsonify({
            'success': True,
            'message': 'Logged out successfully'
        })
        
        # Clear session cookie
        response.set_cookie('session_token', '', expires=0)
        
        return response
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/auth/validate', methods=['GET'])
def validate_session():
    """Validate current session"""
    try:
        auth_header = request.headers.get('Authorization')
        token = None
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        else:
            token = request.cookies.get('session_token')
        
        if not token:
            return jsonify({
                'success': False,
                'error': 'No session token provided'
            }), 401
        
        is_valid, user_info = auth_manager.validate_session(token)
        
        if is_valid:
            return jsonify({
                'success': True,
                'user': user_info
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Invalid or expired session'
            }), 401
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/auth/me', methods=['GET'])
@require_auth()
def get_current_user():
    """Get current user information"""
    return jsonify({
        'success': True,
        'user': request.user
    })


# ============================================================
# Document Management API Endpoints
# ============================================================

@app.route('/api/documents', methods=['GET'])
def get_documents():
    """Get list of all documents"""
    try:
        docs = document_manager.get_all_documents()
        return jsonify(docs)
    except Exception as e:
        return jsonify({
            'error': str(e)
        }), 500


@app.route('/api/upload', methods=['POST'])
def upload_documents():
    """Upload and process multiple documents"""
    try:
        if 'files' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No files provided'
            }), 400
        
        files = request.files.getlist('files')
        if not files:
            return jsonify({
                'success': False,
                'error': 'No files selected'
            }), 400
        
        uploaded_count = 0
        uploaded_files = []
        skipped_files = []
        files_to_upload = []
        
        # Get all existing documents from database
        existing_docs = document_manager.get_all_documents()
        existing_filenames = [doc['filename'] for doc in existing_docs]
        
        # First pass: identify files to upload
        for file in files:
            if file and file.filename and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                
                # Check if file exists in database
                if filename in existing_filenames:
                    skipped_files.append(filename)
                    print(f"Skipping {filename} - already in database")
                    continue
                
                # Mark this file for upload (including orphaned files - we'll overwrite them)
                files_to_upload.append(file)
                
                # If file exists on disk but not in database, it's orphaned - we'll overwrite it
                file_path = os.path.join(DATA_DIR, filename)
                if os.path.exists(file_path):
                    print(f"Found orphaned file: {filename} - will overwrite")
        
        # Second pass: actually upload the files
        for file in files_to_upload:
            filename = secure_filename(file.filename)
            file_path = os.path.join(DATA_DIR, filename)
            
            try:
                # Check if file exists (orphaned file)
                is_orphaned = os.path.exists(file_path)
                
                if is_orphaned:
                    # For orphaned files, save to temp location first
                    import uuid
                    temp_filename = f"{uuid.uuid4().hex}_{filename}"
                    temp_path = os.path.join(DATA_DIR, temp_filename)
                    
                    file.save(temp_path)
                    print(f"Saved to temp: {temp_filename}")
                    
                    # Try to replace the orphaned file
                    try:
                        # On Windows, need to remove first if file is locked
                        if os.path.exists(file_path):
                            os.remove(file_path)
                        os.rename(temp_path, file_path)
                        print(f"Replaced orphaned file: {filename}")
                    except Exception as replace_error:
                        # If replace fails, just use the temp file
                        print(f"Could not replace orphaned file, using new name: {replace_error}")
                        file_path = temp_path
                        filename = temp_filename
                else:
                    # Normal save for new files
                    file.save(file_path)
                    print(f"Saved file: {filename}")
                
                # Get file info
                file_size = os.path.getsize(file_path)
                file_type = Path(filename).suffix.lower()
                
                # Add to database
                document_manager.add_document(
                    filename=filename,
                    original_filename=filename,
                    file_type=file_type,
                    file_size=file_size,
                    uploaded_by='admin'
                )
                
                uploaded_files.append(file_path)
                uploaded_count += 1
                print(f"Successfully uploaded: {filename}")
                
            except Exception as e:
                print(f"Error uploading {filename}: {e}")
                skipped_files.append(filename)
                continue
        
        if uploaded_count > 0:
            # Process documents with RAG pipeline
            try:
                pipeline.store_nodes(input_files=uploaded_files)
                pipeline.set_chat_mode()
                
                message = f'Successfully uploaded and processed {uploaded_count} document(s)'
                if skipped_files:
                    message += f'. Skipped {len(skipped_files)} duplicate(s): {", ".join(skipped_files)}'
                
                return jsonify({
                    'success': True,
                    'uploaded': uploaded_count,
                    'skipped': len(skipped_files),
                    'message': message
                })
            except Exception as e:
                return jsonify({
                    'success': True,
                    'uploaded': uploaded_count,
                    'warning': f'Uploaded but processing failed: {str(e)}'
                })
        else:
            message = 'No new files uploaded'
            if skipped_files:
                message += f'. All {len(skipped_files)} file(s) already exist: {", ".join(skipped_files)}'
            
            return jsonify({
                'success': False,
                'error': message
            }), 400
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/documents/<int:doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    """Delete a document"""
    try:
        # Get document info
        doc = document_manager.get_document(doc_id)
        if not doc:
            return jsonify({
                'success': False,
                'error': 'Document not found'
            }), 404
        
        # Delete from database first
        success = document_manager.delete_document(doc_id)
        if not success:
            return jsonify({
                'success': False,
                'error': 'Failed to delete from database'
            }), 500
        
        # Reset the pipeline to release file handles
        pipeline.reset_documents()
        pipeline.reset_conversation()
        
        # Now we can safely delete the physical file
        file_path = os.path.join(DATA_DIR, doc['filename'])
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as file_error:
            print(f"Warning: Could not delete physical file: {file_error}")
            # Continue anyway - database entry is already deleted
        
        # Rebuild RAG index with remaining documents
        remaining_docs = document_manager.get_all_documents()
        if remaining_docs:
            doc_paths = [os.path.join(DATA_DIR, d['filename']) for d in remaining_docs]
            pipeline.store_nodes(input_files=doc_paths)
            pipeline.set_chat_mode()
        
        return jsonify({
            'success': True,
            'message': f'Document {doc["filename"]} deleted successfully'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/reports', methods=['GET'])
def get_reports():
    """Get list of user reports"""
    try:
        status = request.args.get('status', 'all')
        
        if status == 'all':
            reports = report_manager.get_all_reports()
        else:
            reports = report_manager.get_all_reports(status=status.lower())
        
        return jsonify({
            'success': True,
            'reports': reports
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/reports/<int:report_id>', methods=['GET'])
def get_report(report_id):
    """Get details of a specific report"""
    try:
        report = report_manager.get_report(report_id)
        if not report:
            return jsonify({
                'success': False,
                'error': 'Report not found'
            }), 404
        
        return jsonify({
            'success': True,
            'report': report
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/reports/<int:report_id>/resolve', methods=['POST'])
def resolve_report(report_id):
    """
    Mark a report as resolved
    
    When users report incorrect/incomplete AI responses, admins can take these actions:
    1. Upload better documents: Add more comprehensive or updated documents
    2. Check document quality: Review if existing documents contain correct information
    3. Update/delete outdated docs: Remove or replace documents with incorrect info
    4. Re-index documents: Delete and re-upload documents if processed incorrectly
    5. Improve document format: Convert image-only PDFs to text-searchable format
    
    The resolution_notes field tracks what action was taken to fix the issue.
    """
    try:
        data = request.json
        resolution_notes = data.get('resolution_notes', '')
        
        success = report_manager.resolve_report(
            report_id=report_id,
            resolved_by='admin',
            resolution_notes=resolution_notes
        )
        
        if success:
            return jsonify({
                'success': True,
                'message': f'Report #{report_id} resolved successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to resolve report'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get system statistics"""
    try:
        docs = document_manager.get_all_documents()
        
        # Calculate total storage, tolerating missing historical values
        def _coerce_size(value):
            try:
                return int(value or 0)
            except (TypeError, ValueError):
                return 0

        total_storage = sum(_coerce_size(doc.get('file_size')) for doc in docs)
        
        # Get last upload date
        last_upload = docs[0].get('upload_date') if docs else None
        
        # Get report statistics
        all_reports = report_manager.get_all_reports()
        pending_reports = report_manager.get_all_reports(status='pending')
        resolved_reports = report_manager.get_all_reports(status='resolved')
        
        return jsonify({
            'success': True,
            'stats': {
                'total_documents': len(docs),
                'total_storage': total_storage,
                'last_upload': last_upload,
                'total_reports': len(all_reports),
                'pending_reports': len(pending_reports),
                'resolved_reports': len(resolved_reports)
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500




@app.route('/api/news/init-sources', methods=['POST'])
@require_auth(role='admin')
def initialize_news_sources():
    """Initialize default news sources"""
    try:
        from rag_chatbot.workers.news_fetcher import init_default_sources
        
        init_default_sources()
        
        return jsonify({
            'success': True,
            'message': 'Default news sources initialized'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/news/fetch-all', methods=['POST'])
@require_auth(role='admin')
def fetch_all_news():
    """Fetch news for all roles"""
    try:
        from rag_chatbot.workers.news_fetcher import NewsFetcher
        
        fetcher = NewsFetcher(pipeline)
        results = fetcher.fetch_all_roles(fetch_content=True)
        
        # Embed new articles
        for role_type, count in results.items():
            if count > 0:
                fetcher.embed_articles(role_type, limit=count)
        
        return jsonify({
            'success': True,
            'message': 'News fetched for all roles',
            'results': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    print("="*60)
    print("Starting Admin Interface Server")
    print("="*60)
    print(f"URL: http://localhost:7860")
    print("="*60)
    app.run(host='0.0.0.0', port=7860, debug=False)