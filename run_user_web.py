"""
Flask backend API for the User Interface
Serves the HTML UI and provides REST API endpoints for:
- Querying the chatbot
- Getting document list
- Viewing statistics
- Submitting reports
- User authentication
"""
import os
import json
import time
from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context, redirect
from flask_cors import CORS
from rag_chatbot.pipeline import LocalRAGPipeline
from rag_chatbot.logger import Logger
from rag_chatbot.database import report_manager, chat_history_manager, document_manager
from rag_chatbot.auth import AuthManager
from rag_chatbot.chat_storage import chat_storage
from functools import wraps
import uuid
import sys

# Set offline mode for HuggingFace
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

# Get absolute path to UI directory
UI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'UI')
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'knowledge_base.db')

app = Flask(__name__, 
            template_folder=UI_DIR,
            static_folder=UI_DIR,
            static_url_path='')
CORS(app)

# Determine which LLM to use based on environment variable
# Options: "gemini", "openrouter", "ollama" (default)
llm_provider = os.environ.get('LLM_PROVIDER', 'ollama').lower()

# Initialize pipeline and auth
logger = Logger("logging.log")
# Initialize without auto-loading documents to avoid network calls during startup
# Documents will be loaded on first query

if llm_provider == 'gemini':
    gemini_api_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable required when LLM_PROVIDER=gemini")
    print("=" * 80)
    print("🚀 Using Gemini API for fast responses (2-5 seconds)")
    print("=" * 80)
    pipeline = LocalRAGPipeline(auto_init_docs=False, use_gemini=True, gemini_api_key=gemini_api_key)
elif llm_provider == 'openrouter':
    print("=" * 80)
    print("🚀 Using OpenRouter API")
    print("=" * 80)
    # OpenRouter logic would go here if implemented
    pipeline = LocalRAGPipeline(auto_init_docs=False)
else:
    print("=" * 80)
    print("🚀 Using Ollama (local LLM)")
    print("=" * 80)
    pipeline = LocalRAGPipeline(auto_init_docs=False)

auth_manager = AuthManager(DB_PATH)
print("Pipeline initialized (documents will load on first query)")
print("Authentication system initialized")

# Store session data
sessions = {}


# Authentication decorator (optional for user interface - for future use)
def require_auth(optional=False):
    """Decorator to optionally require authentication"""
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
            
            if token:
                # Validate session
                is_valid, user_info = auth_manager.validate_session(token)
                if is_valid:
                    request.user = user_info
                elif not optional:
                    return jsonify({'success': False, 'error': 'Invalid or expired session'}), 401
            elif not optional:
                return jsonify({'success': False, 'error': 'Authentication required'}), 401
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator


@app.route('/')
def index():
    """Serve the main HTML page (requires authentication)"""
    # Check if user is authenticated
    token = request.cookies.get('session_token')
    if not token:
        return redirect('/login')
    
    is_valid, user_info = auth_manager.validate_session(token)
    if not is_valid:
        return redirect('/login')
    
    # Check if user is admin - redirect admins to admin web
    if user_info['role'] == 'admin':
        host = request.host.rsplit(':', 1)[0]
        return redirect(f'http://{host}:7860/admin')
    
    # Send response with no-cache headers to prevent back button issues
    response = send_from_directory(UI_DIR, 'user_index.html')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/login')
def login_page():
    """Serve the login page"""
    # If already logged in, redirect to appropriate page based on role
    token = request.cookies.get('session_token')
    if token:
        is_valid, user_info = auth_manager.validate_session(token)
        if is_valid:
            if user_info['role'] == 'admin':
                # Admin should go to admin web
                host = request.host.rsplit(':', 1)[0]
                return redirect(f'http://{host}:7860/admin')
            else:
                # User already logged in, go to home page
                # Don't redirect to avoid loop, just serve the home page directly
                response = send_from_directory(UI_DIR, 'user_index.html')
                response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                response.headers['Pragma'] = 'no-cache'
                response.headers['Expires'] = '0'
                return response
    
    return send_from_directory(UI_DIR, 'login.html')


@app.route('/signup')
def signup_page():
    """Serve the signup page"""
    return send_from_directory(UI_DIR, 'signup.html')


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


# API Endpoints
# ============================================================

@app.route('/api/documents', methods=['GET'])
def get_documents():
    """Get list of all documents in the system"""
    try:
        docs = document_manager.get_all_documents()
        return jsonify({
            'success': True,
            'documents': docs
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get system statistics (user-specific if logged in)"""
    try:
        docs = document_manager.get_all_documents()
        
        # Get user info from session token
        token = request.cookies.get('session_token')
        user_chat_count = 0
        if token:
            is_valid, user_info = auth_manager.validate_session(token)
            if is_valid:
                user_id = user_info.get('id')
                # Use JSON storage for user count
                user_chat_count = chat_storage.get_user_chat_count(user_id)
        
        # Get total questions from chat history (for all users)
        total_chat_count = chat_history_manager.get_chat_count()
        
        return jsonify({
            'success': True,
            'stats': {
                'total_documents': len(docs),
                'total_questions': total_chat_count,
                'user_questions': user_chat_count
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/chat/history', methods=['GET'])
def get_chat_history():
    """Get user's chat history from JSON storage"""
    try:
        # Get user info from session token
        token = request.cookies.get('session_token')
        if not token:
            return jsonify({
                'success': False,
                'error': 'Authentication required'
            }), 401
        
        is_valid, user_info = auth_manager.validate_session(token)
        if not is_valid:
            return jsonify({
                'success': False,
                'error': 'Invalid session'
            }), 401
        
        user_id = user_info.get('id')
        limit = request.args.get('limit', type=int)  # Optional limit parameter
        
        # Get history from JSON storage
        history = chat_storage.get_user_history(user_id, limit=limit)
        
        return jsonify({
            'success': True,
            'history': history,
            'count': len(history)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/chat/clear', methods=['POST'])
def clear_chat_history():
    """Clear user's chat history"""
    try:
        # Get user info from session token
        token = request.cookies.get('session_token')
        if not token:
            return jsonify({
                'success': False,
                'error': 'Authentication required'
            }), 401
        
        is_valid, user_info = auth_manager.validate_session(token)
        if not is_valid:
            return jsonify({
                'success': False,
                'error': 'Invalid session'
            }), 401
        
        user_id = user_info.get('id')
        
        # Clear history from JSON storage
        success = chat_storage.clear_user_history(user_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Chat history cleared successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to clear history'
            }), 500
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/query', methods=['POST'])
def query():
    """Handle chat query with streaming response"""
    try:
        data = request.json
        message = data.get('message', '').strip()
        session_id = data.get('session_id', str(uuid.uuid4()))
        chat_history = data.get('chat_history', [])
        
        # Get user info from session token
        token = request.cookies.get('session_token')
        user_id = None
        if token:
            is_valid, user_info = auth_manager.validate_session(token)
            if is_valid:
                user_id = user_info.get('id')
        
        if not message:
            return jsonify({
                'success': False,
                'error': 'Message cannot be empty'
            }), 400
        
        # Check if model is initialized
        if not pipeline.get_model_name():
            return jsonify({
                'success': False,
                'error': 'System is initializing, please wait...'
            }), 503
        
        # Initialize documents if not already done
        if pipeline._query_engine is None:
            print("Loading documents for the first time...")
            pipeline._initialize_existing_documents()
            print("Documents loaded!")
        
        def generate():
            """Generator function for streaming response"""
            import time
            start_time = time.time()
            
            try:
                print(f"[DEBUG] Starting query processing at {start_time}")
                
                # Convert chat history to expected format
                formatted_history = []
                for item in chat_history:
                    if len(item) == 2:
                        formatted_history.append([item[0], item[1]])
                
                print(f"[DEBUG] Getting response from pipeline...")
                # Get response from pipeline - use "QA" mode like old Gradio UI
                response = pipeline.query("QA", message, formatted_history)
                
                print(f"[DEBUG] Response type: {type(response)}")
                print(f"[DEBUG] Has response_gen: {hasattr(response, 'response_gen')}")
                print(f"[DEBUG] Has response: {hasattr(response, 'response')}")
                
                # Check if we have a non-streaming response first
                if hasattr(response, 'response') and response.response:
                    print(f"[DEBUG] Non-streaming response available: {len(response.response)} chars")
                    # Send the whole response as tokens
                    full_text = response.response
                    for i in range(0, len(full_text), 10):
                        chunk = full_text[i:i+10]
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
                    answer_text = [full_text]
                    token_count = len(full_text) // 10
                elif hasattr(response, 'response_gen'):
                    print(f"[DEBUG] response_gen type: {type(response.response_gen)}")
                    print(f"[DEBUG] Starting to stream tokens...")
                    # Stream answer as it's generated
                    answer_text = []
                    token_count = 0
                    
                    try:
                        for text in response.response_gen:
                            answer_text.append(text)
                            token_count += 1
                            
                            # Send partial answer as JSON
                            yield f"data: {json.dumps({'type': 'token', 'content': text})}\n\n"
                        
                        print(f"[DEBUG] Streamed {token_count} tokens in {time.time() - start_time:.2f}s")
                    except Exception as gen_error:
                        print(f"[ERROR] Error during token generation: {str(gen_error)}")
                        print(f"[ERROR] Error type: {type(gen_error).__name__}")
                        import traceback
                        traceback.print_exc()
                        raise
                else:
                    print(f"[ERROR] No response or response_gen available!")
                    answer_text = ["Error: No response available from LLM"]
                    token_count = 0
                
                final_answer = "".join(answer_text)
                
                # Extract sources
                sources = []
                if hasattr(response, 'source_nodes') and len(response.source_nodes) > 0:
                    import re
                    
                    # Extract key terms from answer
                    answer_words = set([w.lower() for w in re.findall(r'\w+', final_answer) if len(w) > 3])
                    
                    # Score each node
                    best_node = None
                    best_alignment_score = -1
                    
                    for node in response.source_nodes[:3]:
                        source_text = node.node.text.lower()
                        alignment_score = sum(1 for word in answer_words if word in source_text)
                        retriever_score = node.score if hasattr(node, 'score') else 0
                        combined_score = alignment_score * 10 + retriever_score
                        
                        if combined_score > best_alignment_score:
                            best_alignment_score = combined_score
                            best_node = node
                    
                    if not best_node:
                        best_node = max(response.source_nodes, key=lambda x: x.score if hasattr(x, 'score') else 0)
                    
                    metadata = best_node.node.metadata
                    sources.append({
                        'filename': metadata.get('file_name', 'Unknown'),
                        'page': metadata.get('page_label', None),
                        'score': float(best_node.score) if hasattr(best_node, 'score') else 0.0
                    })
                
                # Store in session for report functionality
                if session_id not in sessions:
                    sessions[session_id] = {}
                
                sessions[session_id]['last_response'] = {
                    'question': message,
                    'answer': final_answer,
                    'sources': sources
                }
                
                # Save to database (for backward compatibility)
                chat_history_manager.add_chat(
                    session_id=session_id,
                    question=message,
                    answer=final_answer,
                    sources=sources,
                    user_type="user",
                    user_id=user_id
                )
                
                # Save to JSON file (new storage method)
                if user_id:
                    chat_storage.save_chat(
                        user_id=user_id,
                        question=message,
                        answer=final_answer,
                        sources=sources,
                        session_id=session_id
                    )
                
                # Send completion with sources
                yield f"data: {json.dumps({'type': 'done', 'sources': sources, 'session_id': session_id})}\n\n"
                
            except Exception as e:
                error_msg = str(e)
                if "No documents loaded" in error_msg:
                    error_msg = "No documents available yet. Please contact your administrator to upload company documents first."
                
                yield f"data: {json.dumps({'type': 'error', 'error': error_msg})}\n\n"
        
        return Response(stream_with_context(generate()), mimetype='text/event-stream')
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# @app.route('/api/report', methods=['POST'])
# def submit_report():
#     """Submit a user report about incorrect/missing information"""
#     try:
#         data = request.json
#         session_id = data.get('session_id')
#         report_type = data.get('report_type', 'incorrect')
#         details = data.get('details', '')
        
#         # Get last response from session
#         last_response = None
#         if session_id and session_id in sessions:
#             last_response = sessions[session_id].get('last_response')
        
#         if not last_response:
#             return jsonify({
#                 'success': False,
#                 'error': 'No recent conversation found for this report'
#             }), 400
        
#         # Create report
#         report_id = report_manager.create_report(
#             question=last_response['question'],
#             answer=last_response['answer'],
#             report_type=report_type,
#             report_reason=report_type,  # Use report_type as reason
#             user_comment=details  # Details go into user_comment
#         )
        
#         return jsonify({
#             'success': True,
#             'report_id': report_id,
#             'message': 'Report submitted successfully. Thank you for your feedback!'
#         })
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

@app.route('/api/report', methods=['POST'])
def submit_report():
    """Submit a user report about incorrect/missing information"""
    try:
        data = request.json
        session_id = data.get('session_id')
        report_type = data.get('report_type', 'incorrect')
        details = data.get('details', '')

        # 🧠 Lấy phản hồi cuối cùng từ session (nếu có)
        last_response = None
        if session_id and session_id in sessions:
            last_response = sessions[session_id].get('last_response')

        # 🧩 Nếu không tìm thấy hội thoại gần nhất → vẫn cho phép gửi báo cáo
        if not last_response:
            print(f"[WARN] No last_response found for session {session_id}. Creating fallback report.")
            report_id = report_manager.create_report(
                question="(No conversation found)",
                answer="(No AI response)",
                report_type=report_type,
                report_reason=report_type,
                user_comment=details
            )
            return jsonify({
                'success': True,
                'report_id': report_id,
                'message': 'Report submitted without conversation context.'
            })

        # ✅ Nếu có hội thoại → tạo báo cáo đầy đủ
        report_id = report_manager.create_report(
            question=last_response.get('question', '(Unknown question)'),
            answer=last_response.get('answer', '(Unknown answer)'),
            report_type=report_type,
            report_reason=report_type,
            user_comment=details
        )

        return jsonify({
            'success': True,
            'report_id': report_id,
            'message': 'Report submitted successfully. Thank you for your feedback!'
        })

    except Exception as e:
        print(f"[ERROR] Report submission failed: {str(e)}")  # Log lỗi ra console
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# @app.route('/api/download/<int:doc_id>', methods=['GET'])
# def download_document(doc_id):
#     """Download a document file"""
#     try:
#         doc = document_manager.get_document(doc_id)
#         if not doc:
#             return jsonify({
#                 'success': False,
#                 'error': 'Document not found'
#             }), 404
        
#         file_path = doc['file_path']
#         if not os.path.exists(file_path):
#             return jsonify({
#                 'success': False,
#                 'error': 'File not found on disk'
#             }), 404
        
#         directory = os.path.dirname(file_path)
#         filename = os.path.basename(file_path)
        
#         return send_from_directory(directory, filename, as_attachment=True)
        
#     except Exception as e:
#         return jsonify({
#             'success': False,
#             'error': str(e)
#         }), 500

@app.route('/api/download/<int:doc_id>', methods=['GET'])
def download_document(doc_id):
    """Download a document file"""
    try:
        doc = document_manager.get_document(doc_id)
        if not doc:
            return jsonify({
                'success': False,
                'error': 'Document not found'
            }), 404

        filename = doc.get('filename') or doc.get('original_filename')
        if not filename:
            return jsonify({
                'success': False,
                'error': 'Missing filename in database'
            }), 500

        base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'data')
        file_path = os.path.join(base_dir, filename)

        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': f'File not found on disk: {file_path}'
            }), 404
        
        directory = os.path.dirname(file_path)
        filename = os.path.basename(file_path)
        return send_from_directory(directory, filename, as_attachment=True)

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



@app.route('/api/clear-chat', methods=['POST'])
def clear_chat():
    """Clear chat history for a session"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if session_id and session_id in sessions:
            sessions[session_id] = {}
        
        # Clear pipeline conversation
        pipeline.clear_conversation()
        
        return jsonify({
            'success': True,
            'message': 'Chat history cleared'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    print("="*60)
    print("Starting User Interface Server")
    print("="*60)
    print(f"URL: http://localhost:7861")
    print(f"Model: {pipeline.get_model_name()}")
    print("="*60)
    
    app.run(host='0.0.0.0', port=7861, debug=False)