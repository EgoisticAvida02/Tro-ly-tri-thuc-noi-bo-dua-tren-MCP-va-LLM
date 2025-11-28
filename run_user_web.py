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
import re
from typing import Dict
from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context, redirect
from flask_cors import CORS
from rag_chatbot.pipeline import LocalRAGPipeline
from rag_chatbot.logger import Logger
from rag_chatbot.database import report_manager, chat_history_manager, document_manager, news_manager
from rag_chatbot.auth import AuthManager
from rag_chatbot.chat_storage import chat_storage
from rag_chatbot.query_optimizer import extract_document_from_query, translate_query_to_vietnamese, should_use_vietnamese_response
from functools import wraps
import uuid
import sys

# Set offline mode for HuggingFace
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

# Get absolute path to UI directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(BASE_DIR, 'UI')
DB_PATH = os.path.join(BASE_DIR, 'data', 'knowledge_base.db')
DATA_DIR = os.path.join(BASE_DIR, 'data', 'data')
os.makedirs(DATA_DIR, exist_ok=True)

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
# Initialize with auto-loading documents from cache for fast startup
# Cached embeddings will be used when available - first startup may take longer

if llm_provider == 'gemini':
    gemini_api_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable required when LLM_PROVIDER=gemini")
    print("=" * 80)
    print("🚀 Using Gemini API for fast responses (2-5 seconds)")
    print("=" * 80)
    pipeline = LocalRAGPipeline(auto_init_docs=True, use_gemini=True, gemini_api_key=gemini_api_key)
elif llm_provider == 'openrouter':
    print("=" * 80)
    print("🚀 Using OpenRouter API")
    print("=" * 80)
    # OpenRouter logic would go here if implemented
    pipeline = LocalRAGPipeline(auto_init_docs=True)
else:
    print("=" * 80)
    print("🚀 Using Ollama (local LLM)")
    print("=" * 80)
    pipeline = LocalRAGPipeline(auto_init_docs=True)

auth_manager = AuthManager(DB_PATH)
print("✓ Pipeline initialized - documents ready for users")
print("✓ Authentication system initialized")

# Store session data
sessions = {}


def chunk_text(text: str, chunk_size: int = 80):
    """Yield small chunks of text for streaming responses."""
    for i in range(0, len(text), chunk_size):
        yield text[i:i+chunk_size]


def normalize_selected_filenames(selected_docs):
    """Extract unique filenames from the selected documents payload."""
    if not selected_docs:
        return []

    filenames = []
    seen = set()

    for doc in selected_docs:
        if not isinstance(doc, dict):
            continue
        raw_name = (doc.get('filename') or doc.get('file_name') or '').strip()
        if not raw_name:
            continue
        base_name = os.path.basename(raw_name)
        if base_name and base_name not in seen:
            seen.add(base_name)
            filenames.append(base_name)

    return filenames


def record_chat_interaction(session_id: str, question: str, answer: str, sources, user_id):
    """Persist chat data in both the in-memory session cache and storage layers."""
    sources = sources or []

    if session_id not in sessions:
        sessions[session_id] = {}

    sessions[session_id]['last_response'] = {
        'question': question,
        'answer': answer,
        'sources': sources
    }

    chat_history_manager.add_chat(
        session_id=session_id,
        question=question,
        answer=answer,
        sources=sources,
        user_type="user",
        user_id=user_id
    )

    if user_id:
        chat_storage.save_chat(
            user_id=user_id,
            question=question,
            answer=answer,
            sources=sources,
            session_id=session_id
        )


def extract_news_query(message: str):
    if not message:
        return None
    lowered = message.lower()
    triggers = [
        "tell me more about",
        "chi tiết về",
        "hãy cho tôi biết thêm về",
        "news:"
    ]
    if not any(trigger in lowered for trigger in triggers):
        return None
    for trigger in triggers:
        idx = lowered.find(trigger)
        if idx != -1:
            candidate = message[idx + len(trigger):].strip(" :\"'“”")
            if candidate:
                return candidate
    return message.strip()


def get_news_article_answer(message: str):
    """Return a canned response sourced from the news database if applicable."""
    query = extract_news_query(message)
    if not query:
        return None

    article = news_manager.find_article_by_title(query)
    if not article:
        return None

    answer = build_article_summary(article)
    source_name = article.get('source_name') or 'Tech News'
    published = article.get('published_date') or 'Unknown date'
    link = article.get('url')

    return {
        'answer': answer,
        'sources': [{
            'filename': f"{source_name} article",
            'page': published,
            'score': 1.0,
            'link': link
        }]
    }


PROMO_SNIPPET_PATTERNS = [
    "5 ways to secure containers",
    "containers move fast",
    "manage container risk at scale",
    "they're created and removed in seconds"
]


def is_placeholder_snippet(text: str | None) -> bool:
    """Check if text is just a promotional snippet, not actual article content."""
    if not text:
        return False
    lowered = text.lower()
    # Must have at least 2 promo patterns to be considered placeholder
    matches = sum(1 for pattern in PROMO_SNIPPET_PATTERNS if pattern in lowered)
    return matches >= 2


def _extract_sentences(text: str, max_sentences: int = 6) -> list[str]:
    if not text:
        return []
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    results = []
    for sentence in sentences:
        cleaned = sentence.strip()
        if len(cleaned.split()) < 4:
            continue
        results.append(cleaned)
        if len(results) >= max_sentences:
            break
    return results


def _prepare_article_chunk(content: str, limit: int = 6000) -> str:
    if not content or is_placeholder_snippet(content):
        return ''
    text = re.sub(r'\s+', ' ', content).strip()
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    last_period = truncated.rfind('. ')
    if last_period > 2000:
        truncated = truncated[:last_period+1]
    return truncated + "\n...(article truncated for brevity)"


def build_article_summary(article: Dict, content_override: str | None = None) -> str:
    """Create a human-friendly summary for a news article."""
    title = article.get('title', 'this article')
    base_summary = (article.get('summary') or '').strip()
    if is_placeholder_snippet(base_summary):
        base_summary = ''

    content_candidate = content_override or article.get('content') or ''
    if is_placeholder_snippet(content_candidate):
        content_candidate = ''

    content = content_candidate.strip()
    sentences = _extract_sentences(content, max_sentences=10)
    key_points = sentences[:6]

    paragraphs = []

    lead_sentence = ''
    if base_summary and len(base_summary.split()) > 10:
        lead_sentence = base_summary
    elif sentences:
        lead_sentence = sentences[0]

    if lead_sentence:
        paragraphs.append(f"**{title}** — {lead_sentence}" if title.lower() not in lead_sentence.lower() else lead_sentence)
    elif title:
        paragraphs.append(f"**{title}** — Key highlights forthcoming once we have more details.")

    if key_points and len(key_points) > 1:
        supporting_text = " ".join(key_points[1:])
        if supporting_text:
            paragraphs.append(supporting_text)

    metadata_lines = []
    source_name = article.get('source_name') or article.get('source')
    published = article.get('published_date')
    link = article.get('url')
    if source_name or published:
        parts = [part for part in [source_name, published] if part]
        metadata_lines.append(' • '.join(parts))
    if link:
        metadata_lines.append(link)

    if metadata_lines:
        paragraphs.append("Source: " + " | ".join(metadata_lines))

    return "\n\n".join(paragraphs)


def build_structured_brief(article: Dict, raw_text: str) -> str:
    usable_text = raw_text if not is_placeholder_snippet(raw_text) else ''
    sentences = _extract_sentences(usable_text, max_sentences=10)
    if not sentences:
        return ''

    overview = sentences[:2]
    findings = sentences[2:6]
    impact = sentences[6:8]
    recommendations = sentences[8:10]

    paragraphs = []
    title = article.get('title', 'this article')

    if overview:
        paragraphs.append(f"**{title}** — {' '.join(overview)}")

    if findings:
        paragraphs.append("What stands out: " + " ".join(findings))

    if impact:
        paragraphs.append("Why it matters: " + " ".join(impact))

    if recommendations:
        paragraphs.append("Suggested focus: " + " ".join(recommendations))

    return "\n\n".join(paragraphs)


def generate_llm_article_summary(article: Dict, content: str) -> str:
    """Use the configured LLM to build a deeper summary from raw article text."""
    primary_text = '' if is_placeholder_snippet(content) else (content or '')
    cleaned_content = _prepare_article_chunk(primary_text)
    if not cleaned_content:
        fallback = (
            article.get('summary') or
            article.get('content_snippet') or
            article.get('description') or
            ''
        )
        cleaned_content = _prepare_article_chunk(fallback, limit=2000)
    if not cleaned_content:
        print('[WARN] No usable content for LLM article summarization')
        return ''

    title = article.get('title') or 'this article'
    source_name = article.get('source_name') or article.get('source') or 'Tech News'
    published = article.get('published_date') or 'Unknown date'

    print(f'[INFO] Summarizing article: {title[:80]}...')
    print(f'[INFO] Content length for LLM: {len(cleaned_content)} chars')

    prompt = (
        "You are a cybersecurity analyst. Read the following news article and provide a comprehensive,"
        " natural summary that helps readers understand what happened, why it matters, and what they should know.\n\n"
        "Write in a clear, informative style - NOT in a rigid format. Explain the story naturally as if briefing a colleague.\n\n"
        f"Article: {title}\n"
        f"Source: {source_name}\n"
        f"Date: {published}\n\n"
        "Content:\n" + cleaned_content + "\n\n"
        "Provide a detailed summary covering:\n"
        "- What happened (the main story/incident/announcement)\n"
        "- Technical details and important specifics\n"
        "- Why this matters and potential impact\n"
        "- Any recommendations or actions mentioned\n\n"
        "Write naturally and comprehensively. Use paragraphs, not bullet points."
    )

    # Use the correct LLM based on configuration
    llm = pipeline._default_model
    if not llm:
        print('[WARN] LLM not initialized for article summary request')
        return ''

    try:
        print('[INFO] Calling LLM for article summary...')
        result = llm.complete(prompt)
        text = getattr(result, 'text', '') if result is not None else ''
        output = (text or '').strip()
        print(f'[INFO] LLM returned {len(output)} chars')
        return output
    except Exception as exc:
        print(f'[ERROR] LLM article summary failed: {exc}')
        import traceback
        traceback.print_exc()
        return ''


SOURCE_TOKEN_PATTERN = re.compile(r'\w+')


def select_relevant_sources(answer_text: str, source_nodes, max_sources: int = 2):
    """Return the most relevant source documents for a response."""
    if not source_nodes:
        return []

    normalized_answer = (answer_text or '').lower()
    answer_terms = {
        token for token in SOURCE_TOKEN_PATTERN.findall(normalized_answer)
        if len(token) > 3
    }

    scored_nodes = []
    for node in source_nodes:
        base_node = getattr(node, 'node', None)
        metadata = (getattr(base_node, 'metadata', None) or
                    getattr(node, 'metadata', {}) or {})
        source_text = getattr(base_node, 'text', '') or ''
        source_text_lower = source_text.lower()
        alignment_score = sum(1 for term in answer_terms if term in source_text_lower)
        retriever_score = float(getattr(node, 'score', 0.0) or 0.0)
        combined_score = alignment_score * 10 + retriever_score

        file_name = (metadata.get('file_name') or metadata.get('file_path') or
                     metadata.get('source') or 'Unknown')
        file_path = metadata.get('file_path')
        page_label = (metadata.get('page_label') or metadata.get('page_number') or
                      metadata.get('page'))

        scored_nodes.append({
            'filename': file_name,
            'file_path': file_path,
            'page': page_label,
            'score': retriever_score,
            'combined': combined_score
        })

    scored_nodes.sort(key=lambda item: (item['combined'], item['score']), reverse=True)

    results = []
    seen_keys = set()
    for item in scored_nodes:
        key = (item['filename'], item['file_path'])
        if key in seen_keys:
            continue
        if item['combined'] <= 0 and results:
            continue
        seen_keys.add(key)
        results.append({
            'filename': item['filename'],
            'page': item['page'],
            'score': item['score']
        })
        if len(results) >= max_sources:
            break

    if not results and scored_nodes:
        top = scored_nodes[0]
        results.append({
            'filename': top['filename'],
            'page': top['page'],
            'score': top['score']
        })

    return results


def format_llm_error_message(error_text: str):
    """Return a user-friendly message and HTTP status for LLM errors."""
    fallback = "The AI model couldn't generate a response right now. Please try again in a moment."
    status_code = 500
    if not error_text:
        return fallback, status_code
    lowered = error_text.lower()
    if '503' in error_text or 'unavailable' in lowered or 'overloaded' in lowered:
        return "The AI model is temporarily overloaded. Please wait a few seconds and try again.", 503
    if 'deadline' in lowered or 'timeout' in lowered:
        return "The AI request took too long to respond. Please retry your question.", 504
    if 'rate limit' in lowered or 'too many requests' in lowered:
        return "Too many questions were sent at once. Please pause briefly before trying again.", 429
    return fallback, status_code


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
        technical_role = data.get('technical_role')
        
        success, message, user_id = auth_manager.register_user(
            username=username,
            email=email,
            password=password,
            full_name=full_name,
            role='user',  # Default role is user
            technical_role=technical_role
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
        error_msg = str(e)
        status_code = 500
        if "No documents loaded" in error_msg:
            error_msg = "No documents available yet. Please contact your administrator to upload company documents first."
            status_code = 503
        else:
            error_msg, status_code = format_llm_error_message(error_msg)
        return jsonify({
            'success': False,
            'error': error_msg
        }), status_code


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
        data = request.json or {}
        message = data.get('message', '').strip()
        session_id = data.get('session_id', str(uuid.uuid4()))
        chat_history = data.get('chat_history', [])
        selected_documents = data.get('selected_documents') or []
        selected_filenames = normalize_selected_filenames(selected_documents)
        
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

        news_answer = get_news_article_answer(message)
        if news_answer:
            def stream_news_answer():
                final_answer = news_answer['answer']
                sources = news_answer['sources']
                record_chat_interaction(session_id, message, final_answer, sources, user_id)
                for chunk in chunk_text(final_answer):
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'sources': sources, 'session_id': session_id})}\n\n"
            return Response(stream_with_context(stream_news_answer()), mimetype='text/event-stream')
        
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
                
                # Smart document detection and optimization
                optimized_message = message
                optimized_selected = selected_filenames
                
                # Check if query mentions a specific document
                if selected_filenames:
                    specific_doc = extract_document_from_query(message, selected_filenames)
                    if specific_doc:
                        print(f"[OPTIMIZE] Detected query about specific document: {specific_doc}")
                        print(f"[OPTIMIZE] Narrowing from {len(selected_filenames)} docs to 1 to save tokens")
                        optimized_selected = [specific_doc]
                
                # Translate to Vietnamese if needed for Vietnamese responses
                translated_message, was_translated = translate_query_to_vietnamese(message)
                if was_translated:
                    print(f"[OPTIMIZE] Translated query to Vietnamese: {translated_message}")
                    optimized_message = translated_message
                elif should_use_vietnamese_response(message):
                    # Query is already in Vietnamese, ensure Vietnamese response
                    print(f"[OPTIMIZE] Query is in Vietnamese, will respond in Vietnamese")
                
                # Convert chat history to expected format and limit to last 4 exchanges (8 messages)
                # This saves tokens by not sending entire conversation history
                formatted_history = []
                history_limit = 4  # Only keep last 4 Q&A pairs to save tokens
                recent_history = chat_history[-history_limit:] if len(chat_history) > history_limit else chat_history
                
                for item in recent_history:
                    if len(item) == 2:
                        formatted_history.append([item[0], item[1]])
                
                if len(chat_history) > history_limit:
                    print(f"[DEBUG] Truncated chat history from {len(chat_history)} to {len(formatted_history)} exchanges to save tokens")
                
                print(f"[DEBUG] Getting response from pipeline...")
                # Get response from pipeline - use "QA" mode like old Gradio UI
                response = pipeline.query(
                    "QA",
                    optimized_message,
                    formatted_history,
                    selected_files=optimized_selected or None,
                )
                
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
                        friendly_msg, _ = format_llm_error_message(str(gen_error))
                        yield f"data: {json.dumps({'type': 'error', 'error': friendly_msg})}\n\n"
                        return
                else:
                    print(f"[ERROR] No response or response_gen available!")
                    answer_text = ["Error: No response available from LLM"]
                    token_count = 0
                
                final_answer = "".join(answer_text)
                
                # Extract sources (best match only for streaming UI)
                sources = select_relevant_sources(
                    final_answer,
                    getattr(response, 'source_nodes', []),
                    max_sources=1
                )
                
                record_chat_interaction(session_id, message, final_answer, sources, user_id)
                
                # Send completion with sources
                yield f"data: {json.dumps({'type': 'done', 'sources': sources, 'session_id': session_id})}\n\n"
                
            except ValueError as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
                return
            except Exception as e:
                error_msg = str(e)
                if "No documents loaded" in error_msg:
                    error_msg = "No documents available yet. Please contact your administrator to upload company documents first."
                else:
                    error_msg, _ = format_llm_error_message(error_msg)
                
                yield f"data: {json.dumps({'type': 'error', 'error': error_msg})}\n\n"
        
        return Response(stream_with_context(generate()), mimetype='text/event-stream')
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat query and return a JSON response (non-streaming)."""
    try:
        data = request.json or {}
        message = data.get('message', '').strip()
        session_id = data.get('session_id') or str(uuid.uuid4())
        chat_history = data.get('chat_history', [])
        selected_documents = data.get('selected_documents') or []
        selected_filenames = normalize_selected_filenames(selected_documents)

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

        if not pipeline.get_model_name():
            return jsonify({
                'success': False,
                'error': 'System is initializing, please wait...'
            }), 503

        if pipeline._query_engine is None:
            print("Loading documents for the first time (JSON chat)...")
            pipeline._initialize_existing_documents()
            print("Documents loaded!")

        # Smart document detection and optimization
        optimized_message = message
        optimized_selected = selected_filenames
        
        # Check if query mentions a specific document
        if selected_filenames:
            specific_doc = extract_document_from_query(message, selected_filenames)
            if specific_doc:
                print(f"[OPTIMIZE] Detected query about specific document: {specific_doc}")
                print(f"[OPTIMIZE] Narrowing from {len(selected_filenames)} docs to 1 to save tokens")
                optimized_selected = [specific_doc]
        
        # Translate to Vietnamese if needed for Vietnamese responses
        translated_message, was_translated = translate_query_to_vietnamese(message)
        if was_translated:
            print(f"[OPTIMIZE] Translated query to Vietnamese: {translated_message}")
            optimized_message = translated_message
        elif should_use_vietnamese_response(message):
            # Query is already in Vietnamese, ensure Vietnamese response
            print(f"[OPTIMIZE] Query is in Vietnamese, will respond in Vietnamese")

        # Limit chat history to last 4 exchanges to save tokens
        history_limit = 4
        recent_history = chat_history[-history_limit:] if len(chat_history) > history_limit else chat_history
        
        formatted_history = []
        for item in recent_history:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                formatted_history.append([item[0], item[1]])
        
        if len(chat_history) > history_limit:
            print(f"[DEBUG] Truncated chat history from {len(chat_history)} to {len(formatted_history)} exchanges to save tokens")

        news_answer = get_news_article_answer(message)
        if news_answer:
            final_answer = news_answer['answer']
            sources = news_answer['sources']
            record_chat_interaction(session_id, message, final_answer, sources, user_id)
            return jsonify({
                'success': True,
                'response': final_answer,
                'sources': sources,
                'session_id': session_id
            })

        response = pipeline.query(
            "QA",
            optimized_message,
            formatted_history,
            selected_files=optimized_selected or None,
        )

        final_answer = ""
        if hasattr(response, 'response') and response.response:
            final_answer = response.response
        elif hasattr(response, 'response_gen'):
            chunks = []
            try:
                for text in response.response_gen:
                    chunks.append(text)
            except Exception as gen_error:
                print(f"[ERROR] JSON chat failed while streaming tokens: {gen_error}")
                import traceback
                traceback.print_exc()
                friendly_msg, status_code = format_llm_error_message(str(gen_error))
                return jsonify({
                    'success': False,
                    'error': friendly_msg
                }), status_code
            final_answer = ''.join(chunks)
        else:
            final_answer = "I'm sorry, I couldn't generate a response this time."

        sources = select_relevant_sources(
            final_answer,
            getattr(response, 'source_nodes', []),
            max_sources=2
        )

        record_chat_interaction(session_id, message, final_answer, sources, user_id)

        return jsonify({
            'success': True,
            'response': final_answer,
            'sources': sources,
            'session_id': session_id
        })

    except ValueError as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
    except Exception as e:
        error_msg = str(e)
        status_code = 500
        if "No documents loaded" in error_msg:
            error_msg = "No documents available yet. Please contact your administrator to upload company documents first."
            status_code = 503
        else:
            error_msg, status_code = format_llm_error_message(error_msg)

        return jsonify({
            'success': False,
            'error': error_msg
        }), status_code


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
        
        # Get data from frontend - support both field names
        question = data.get('question', '')
        answer = data.get('answer', '')
        report_type = data.get('issue_type') or data.get('report_type', 'incorrect')
        user_comment = data.get('comment') or data.get('details', '')
        session_id = data.get('session_id')

        # If no question/answer provided, try to get from session
        if not question or not answer:
            if session_id and session_id in sessions:
                last_response = sessions[session_id].get('last_response')
                if last_response:
                    question = question or last_response.get('question', '(Unknown question)')
                    answer = answer or last_response.get('answer', '(Unknown answer)')

        # Create report with all the data
        report_id = report_manager.create_report(
            question=question or '(No question provided)',
            answer=answer or '(No answer provided)',
            report_type=report_type,
            report_reason=report_type,
            user_comment=user_comment
        )

        return jsonify({
            'success': True,
            'report_id': report_id,
            'message': 'Report submitted successfully. Thank you for your feedback!'
        })

    except Exception as e:
        print(f"[ERROR] Report submission failed: {str(e)}")
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

        file_path = os.path.join(DATA_DIR, filename)

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


@app.route('/api/news/<role_type>', methods=['GET'])
def get_news_for_role(role_type):
    """Get news articles for a specific role"""
    try:
        from rag_chatbot.database import news_manager
        
        limit = request.args.get('limit', 20, type=int)
        articles = news_manager.get_articles_by_role(role_type, limit=limit)
        
        return jsonify({
            'success': True,
            'articles': articles,
            'count': len(articles)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/news/fetch', methods=['POST'])
@require_auth()
def fetch_news():
    """Manually trigger news fetch for user's role"""
    try:
        from rag_chatbot.database import user_role_manager
        from rag_chatbot.workers.news_fetcher import NewsFetcher
        
        user_id = request.user.get('id')
        user_role_info = user_role_manager.get_user_role(user_id)
        
        if not user_role_info:
            return jsonify({
                'success': False,
                'error': 'Please set your technical role first'
            }), 400
        
        role_type = user_role_info['role_type']
        
        # Fetch news
        fetcher = NewsFetcher(pipeline)
        count = fetcher.fetch_news_for_role(role_type, fetch_content=True)
        
        # Embed articles
        if count > 0:
            fetcher.embed_articles(role_type, limit=count)
        
        return jsonify({
            'success': True,
            'message': f'Fetched {count} new articles',
            'count': count
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/news/summarize/<int:article_id>', methods=['POST'])
@require_auth(optional=True)
def summarize_article(article_id):
    """Return a detailed, AI-style summary for a specific article."""
    try:
        from rag_chatbot.database import news_manager
        from rag_chatbot.workers.news_fetcher import NewsFetcher

        data = request.json or {}
        session_id = data.get('session_id') or str(uuid.uuid4())
        question = data.get('question') or f'Summarize article {article_id}'

        article = news_manager.get_article_by_id(article_id)
        if not article:
            return jsonify({
                'success': False,
                'error': 'Article not found'
            }), 404

        print(f'[INFO] Summarize request for article ID {article_id}: {article.get("title", "Unknown")[:80]}')

        # Always try to fetch fresh content for better summaries
        content = ''
        if article.get('url'):
            print(f'[INFO] Fetching live article from: {article["url"]}')
            try:
                fetcher = NewsFetcher()
                fetched = fetcher.fetch_article_content(article['url'])
                
                if fetched:
                    word_count = len(fetched.split())
                    print(f'[INFO] Fetched content: {len(fetched)} chars, {word_count} words')
                    
                    if word_count > 80 and not is_placeholder_snippet(fetched):
                        content = fetched
                        news_manager.update_article_content(article_id, fetched)
                        print('[INFO] Stored fresh fetched content in DB')
                    else:
                        print(f'[WARN] Fetched content invalid ({word_count} words) or placeholder')
                else:
                    print('[WARN] fetch_article_content returned empty')
            except Exception as fetch_err:
                print(f'[ERROR] Content fetch failed: {fetch_err}')
                import traceback
                traceback.print_exc()
        
        # Fallback to stored content if fetch failed
        if not content:
            stored = article.get('content') or ''
            if stored and not is_placeholder_snippet(stored) and len(stored.split()) > 50:
                content = stored
                print(f'[INFO] Using stored content: {len(stored)} chars, {len(stored.split())} words')
            else:
                print('[WARN] Stored content also insufficient')

        print(f'[INFO] Final content for summarization: {len(content)} chars, {len(content.split())} words')

        if not content or len(content.split()) < 30:
            print('[ERROR] Insufficient content for meaningful summarization')
            return jsonify({
                'success': False,
                'error': 'Unable to fetch full article content. The article may be behind a paywall or the source may be blocking automated access.'
            }), 500

        # Try LLM first
        llm_summary = generate_llm_article_summary(article, content)
        if llm_summary and len(llm_summary.split()) > 20:
            summary_text = llm_summary
            print('[INFO] Using LLM summary')
        else:
            print('[WARN] LLM summary failed or too short, trying structured brief...')
            structured_brief = build_structured_brief(article, content)
            if structured_brief and len(structured_brief.split()) > 20:
                summary_text = structured_brief
                print('[INFO] Using structured brief')
            else:
                print('[WARN] Structured brief failed, using fallback summary...')
                summary_text = build_article_summary(article, content_override=content)
                print('[INFO] Using fallback summary')
        
        print(f'[INFO] Summary source: {"LLM" if llm_summary else "Structured" if structured_brief else "Fallback"}')
        if not summary_text.strip():
            return jsonify({
                'success': False,
                'error': 'Unable to summarize this article right now'
            }), 500

        source_name = article.get('source_name') or article.get('source') or 'Tech News'
        sources = [{
            'filename': f"{source_name} article",
            'page': article.get('published_date'),
            'score': 1.0,
            'link': article.get('url')
        }]

        user_id = None
        token = request.cookies.get('session_token')
        if token:
            is_valid, user_info = auth_manager.validate_session(token)
            if is_valid:
                user_id = user_info.get('id')

        record_chat_interaction(session_id, question, summary_text, sources, user_id)

        return jsonify({
            'success': True,
            'summary': summary_text,
            'session_id': session_id,
            'sources': sources,
            'article': {
                'id': article_id,
                'title': article.get('title'),
                'url': article.get('url'),
                'published_date': article.get('published_date'),
                'source_name': source_name
            }
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/user/role', methods=['GET', 'POST'])
def user_role():
    """Get or set user's technical role"""
    try:
        from rag_chatbot.database import user_role_manager
        
        # Try to get user from session, but don't require it
        user_id = None
        token = request.cookies.get('session_token')
        if token:
            is_valid, user_info = auth_manager.validate_session(token)
            if is_valid and user_info:
                user_id = user_info.get('id')
        
        if request.method == 'GET':
            if user_id:
                role_info = user_role_manager.get_user_role(user_id)
                if role_info:
                    return jsonify({
                        'success': True,
                        'role': role_info
                    })
            
            # Default fallback for users without a role set
            return jsonify({
                'success': True,
                'role': {
                    'role_type': 'security_engineer',
                    'department': 'Engineering'
                }
            })
        
        else:  # POST - requires authentication
            if not user_id:
                return jsonify({
                    'success': False,
                    'error': 'Authentication required'
                }), 401
                
            data = request.json
            role_type = data.get('role_type')
            department = data.get('department')
            
            if not role_type:
                return jsonify({
                    'success': False,
                    'error': 'role_type is required'
                }), 400
            
            user_role_manager.set_user_role(user_id, role_type, department)
            
            return jsonify({
                'success': True,
                'message': 'Role updated successfully'
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/user-documents/upload', methods=['POST'])
@require_auth()
def upload_user_document():
    """Upload a document that is immediately available in the knowledge base."""
    try:
        from rag_chatbot.database import user_document_manager, user_role_manager, document_manager

        user_id = request.user.get('id')

        # Get user's role
        user_role_info = user_role_manager.get_user_role(user_id)
        if not user_role_info:
            return jsonify({
                'success': False,
                'error': 'Please set your technical role first'
            }), 400

        role_type = user_role_info['role_type']

        # Check if file was uploaded
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file uploaded'
            }), 400

        file = request.files['file']
        description = request.form.get('description', '')

        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400

        allowed_extensions = ['.pdf', '.docx', '.txt', '.md', '.markdown']
        file_ext = os.path.splitext(file.filename)[1].lower()

        if file_ext not in allowed_extensions:
            return jsonify({
                'success': False,
                'error': f'File type not allowed. Allowed: {", ".join(allowed_extensions)}'
            }), 400

        os.makedirs(DATA_DIR, exist_ok=True)
        unique_filename = f"{uuid.uuid4()}_{file.filename}"
        file_path = os.path.join(DATA_DIR, unique_filename)
        file.save(file_path)

        file_size = os.path.getsize(file_path)

        # Store in main documents table for everyone
        main_doc_id = document_manager.add_document(
            filename=unique_filename,
            original_filename=file.filename,
            file_type=file_ext,
            file_size=file_size,
            uploaded_by=f"user_{user_id}",
            metadata={
                'description': description,
                'role_type': role_type
            }
        )

    # Mirror entry in user_documents for tracking + personal filtering
        user_doc_id = user_document_manager.add_user_document(
            filename=unique_filename,
            original_filename=file.filename,
            file_type=file_ext,
            file_size=file_size,
            uploaded_by=user_id,
            role_type=role_type,
            description=description
        )
        user_document_manager.approve_document(user_doc_id, user_id)

        # Ingest immediately so the document is searchable
        try:
            pipeline.store_nodes(input_files=[file_path])
            pipeline.set_chat_mode()
        except Exception as ingest_error:
            print(f"[UPLOAD] Warning: document saved but ingestion failed: {ingest_error}")

        return jsonify({
            'success': True,
            'message': 'Document uploaded and ready for chat',
            'document_id': main_doc_id,
            'user_document_id': user_doc_id
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/user-documents/my', methods=['GET'])
@require_auth()
def get_my_documents():
    """Get documents uploaded by current user"""
    try:
        from rag_chatbot.database import user_document_manager
        
        user_id = request.user.get('id')
        documents = user_document_manager.get_user_documents(user_id)
        
        return jsonify({
            'success': True,
            'documents': documents
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/user-documents/approved/<role_type>', methods=['GET'])
def get_approved_documents_for_role(role_type):
    """Get all approved documents for a specific role"""
    try:
        from rag_chatbot.database import user_document_manager
        
        documents = user_document_manager.get_approved_documents_by_role(role_type)
        
        return jsonify({
            'success': True,
            'documents': documents
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