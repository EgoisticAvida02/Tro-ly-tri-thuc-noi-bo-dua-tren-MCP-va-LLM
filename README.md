# � Internal Knowledge System (RAG Chatbot)

Enterprise-grade Retrieval Augmented Generation (RAG) system for internal document search and Q&A. Built with Flask, Ollama, ChromaDB, and modern authentication.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![Flask](https://img.shields.io/badge/flask-3.0+-green.svg)

## 📖 Table of Contents

- [✨ Key Features](#-key-features)
- [🏗️ Architecture](#️-architecture)
- [� Quick Start](#-quick-start)
- [💻 Local Development](#-local-development)
- [🔐 Authentication](#-authentication)
- [📁 Project Structure](#-project-structure)
- [🌐 Deployment](#-deployment)
- [📊 Usage](#-usage)
- [🛠️ Tech Stack](#️-tech-stack)

## ✨ Key Features

### For Users
- 💬 **Natural Language Q&A**: Ask questions in plain language, get accurate answers from internal documents
- 📚 **Source Citations**: Every answer includes document name and page number
- 🔍 **Advanced Search**: Semantic search powered by sentence transformers
- 📝 **Chat History**: Persistent chat history across sessions
- 📊 **Personal Analytics**: Track your question count and activity
- 📱 **Responsive UI**: Works seamlessly on desktop and mobile
- 🗑️ **History Management**: Clear chat history anytime

### For Administrators
- 📤 **Document Upload**: Support for PDF, DOCX, TXT, MD files
- 🗂️ **Document Management**: View, search, and delete documents
- 📋 **User Reports**: Review user-submitted issues and feedback
- 👥 **User Management**: Role-based access control (Admin/User)
- 📈 **System Analytics**: Monitor documents, questions, and reports
- 🔒 **Secure Authentication**: SHA-256 hashing, session management

### Technical Features
- 🔐 **Authentication System**: Login/signup with secure session tokens
- 🎯 **Role-Based Access**: Separate admin and user interfaces
- 💾 **Dual Storage**: SQLite database + JSON file storage for redundancy
- 🔄 **Auto Migration**: Automatic database schema updates
- 🚀 **Modern Stack**: Flask backend, vanilla JS frontend
- 🐳 **Docker Ready**: Full Docker Compose setup with Ollama and ChromaDB
- ☁️ **Cloud Ready**: AWS deployment guide included

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer / Nginx                │
├──────────────────────┬──────────────────────────────────┤
│   Admin Web (7860)   │      User Web (7861)            │
│   ┌──────────────┐   │   ┌──────────────┐              │
│   │ Document Mgt │   │   │ Chat Interface│              │
│   │ User Reports │   │   │ Q&A System    │              │
│   │ Analytics    │   │   │ History       │              │
│   └──────────────┘   │   └──────────────┘              │
└──────────────────────┴──────────────────────────────────┘
            │                        │
            ├────────────────────────┤
            │   Authentication       │
            │   (SQLite + Sessions)  │
            └────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
    ┌───▼───┐    ┌────▼────┐   ┌────▼─────┐
    │Ollama │    │ChromaDB │   │  SQLite  │
    │(LLM)  │    │(Vector) │   │(Metadata)│
    └───────┘    └─────────┘   └──────────┘
```

## � Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.10+
- 16GB RAM minimum (32GB recommended for GPU)
- Optional: NVIDIA GPU for faster inference

### 1. Clone Repository
```bash
git clone <your-repo-url>
cd Tro-ly-tri-thuc-noi-bo-dua-tren-MCP-va-LLM
```

### 2. Start with Docker Compose
```bash
# Start all services (Ollama, ChromaDB, Admin Web, User Web)
docker-compose up -d

# Pull Ollama model
docker exec ollama ollama pull qwen2:latest

# Check status
docker-compose ps
```

### 3. Access the System
- **Admin Interface**: http://localhost:7860
  - Default credentials: `admin` / `admin123`
- **User Interface**: http://localhost:7861
  - Register a new account or login

### 4. Upload Documents
1. Login to admin interface
2. Navigate to "Documents" section
3. Upload PDF, DOCX, TXT, or MD files
4. Wait for processing to complete

### 5. Start Asking Questions!
1. Login to user interface
2. Type your question in natural language
3. Get answers with source citations

## 💻 Local Development

### Without Docker

### Without Docker

#### 1. Install UV Package Manager
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Make sure ~/.local/bin is in your PATH
```

#### 2. Install Ollama
- **macOS/Windows**: [Download from ollama.com](https://ollama.com/)
- **Linux**:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ollama pull qwen2:latest
  ```

#### 3. Start ChromaDB
```bash
docker run -d -p 8000:8000 -v ./data/chroma:/chroma/chroma chromadb/chroma:latest
```

#### 4. Install Python Dependencies
```bash
uv sync --active --locked
```

#### 5. Run Services
```bash
# Terminal 1: Start admin web
python run_admin_web.py

# Terminal 2: Start user web  
python run_user_web.py
```

## 🔐 Authentication

### Default Credentials
- **Admin Account**: 
  - Username: `admin`
  - Password: `admin123`
  - **⚠️ Change this immediately in production!**

### User Registration
- Users can self-register at the signup page
- All new users have "user" role by default
- Admin can only be set in database or during initial setup

### Session Management
- Sessions expire after 24 hours
- Tokens stored in cookies + localStorage
- Role-based access control enforced on both backend and frontend

### Security Features
- SHA-256 password hashing
- Secure session tokens (32 bytes)
- HTTP-only cookies
- CSRF protection ready
- Route-level authentication
- Role-based access control

## 📁 Project Structure

```
├── run_admin_web.py          # Admin Flask server (port 7860)
├── run_user_web.py           # User Flask server (port 7861)
├── UI/                       # Frontend files
│   ├── admin_index_new.html  # Admin interface
│   ├── admin_script_new.js   # Admin logic
│   ├── admin_styles_new.css  # Admin styles
│   ├── user_index.html       # User interface
│   ├── user_script.js        # User logic
│   ├── user_styles.css       # User styles
│   ├── login.html            # Login page
│   └── signup.html           # Signup page
├── rag_chatbot/              # Core application
│   ├── auth.py               # Authentication manager
│   ├── database.py           # Database operations
│   ├── chat_storage.py       # JSON chat storage
│   ├── pipeline.py           # RAG pipeline
│   ├── core/                 # Core modules
│   │   ├── embedding/        # Sentence transformers
│   │   ├── engine/           # Retrieval engine
│   │   ├── ingestion/        # Document processing
│   │   ├── model/            # LLM interface
│   │   ├── prompt/           # Prompt templates
│   │   └── vector_store/     # ChromaDB interface
│   └── setting/              # Configuration
├── data/                     # Data storage
│   ├── knowledge_base.db     # SQLite database
│   ├── documents/            # Uploaded documents
│   ├── chat_history/         # JSON chat storage
│   └── chroma/               # Vector database
├── docker-compose.yml        # Docker orchestration
├── Dockerfile                # Container definition
└── AWS_DEPLOYMENT_PLAN.md    # AWS deployment guide
```

## 🌐 Deployment

### AWS EC2 Deployment
Full deployment guide available in [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md)

**Quick Summary:**
1. Launch EC2 instance (g4dn.xlarge or t3.xlarge)
2. Install Docker + NVIDIA drivers (if GPU)
3. Clone repository and configure environment
4. Start services with docker-compose
5. Configure Nginx reverse proxy
6. Setup SSL with Let's Encrypt
7. Configure backups and monitoring

**Estimated Cost**: $167-$443/month depending on instance type

### Production Considerations
- Use Nginx for reverse proxy and SSL termination
- Setup automatic backups (database + documents)
- Configure CloudWatch for monitoring
- Use AWS Secrets Manager for sensitive data
- Enable VPC security groups and firewalls
- Setup log aggregation and analysis

## 📊 Usage

### For Users

1. **Login/Register**
   - Navigate to http://localhost:7861
   - Register new account or login with existing credentials

2. **Ask Questions**
   - Type your question in plain language
   - Example: "What is our vacation policy?"
   - Get instant answer with source citations

3. **View History**
   - Click "Lịch sử" (History) to view past conversations
   - History persists across sessions
   - Clear history anytime

4. **Submit Reports**
   - Found incorrect answer? Click "Report" button
   - Select issue type and provide details
   - Admin will review and improve system

### For Administrators

1. **Upload Documents**
   - Go to "Tài liệu" (Documents) section
   - Click "Upload" button
   - Select PDF, DOCX, TXT, or MD files
   - Wait for processing (~1-2 min per document)

2. **Manage Documents**
   - View all uploaded documents
   - Search by name or file type
   - Delete outdated documents
   - Monitor document count

3. **Review Reports**
   - Go to "Báo cáo" (Reports) section  
   - See user-submitted issues
   - Mark as resolved when fixed
   - Use feedback to improve system

4. **Monitor Analytics**
   - Dashboard shows key metrics
   - Total documents, questions, reports
   - Track system usage over time

## 🛠️ Tech Stack

### Backend
- **Flask**: Web framework for Python
- **SQLite**: Metadata and user database
- **ChromaDB**: Vector database for embeddings
- **Ollama**: Local LLM inference (Qwen2)
- **Sentence Transformers**: Text embedding models

### Frontend
- **Vanilla JavaScript**: No framework dependencies
- **HTML5/CSS3**: Modern responsive design
- **Font Awesome**: Icon library

### Infrastructure
- **Docker**: Containerization
- **Docker Compose**: Multi-container orchestration
- **Nginx**: Reverse proxy (production)
- **AWS EC2**: Cloud hosting option

### AI/ML
- **RAG Pipeline**: Retrieval Augmented Generation
- **Embeddings**: all-MiniLM-L6-v2 (sentence-transformers)
- **LLM**: Qwen2:latest via Ollama
- **Vector Search**: Cosine similarity in ChromaDB

## 📝 Configuration

### Environment Variables
Create `.env` file:
```env
# Flask
FLASK_ENV=production
SECRET_KEY=your-secret-key-here

# Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2:latest

# ChromaDB
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Security
SESSION_TIMEOUT=86400
MAX_UPLOAD_SIZE=50MB
```

### Database Schema
Automatically created on first run:
- `users`: User accounts and authentication
- `sessions`: Active user sessions
- `documents`: Uploaded document metadata
- `chat_history`: Conversation history
- `user_reports`: User-submitted feedback

## 🔧 Troubleshooting

### Services won't start
```bash
# Check Docker containers
docker-compose ps

# View logs
docker-compose logs -f

# Restart services
docker-compose restart
```

### Ollama model not loading
```bash
# Pull model manually
docker exec ollama ollama pull qwen2:latest

# List available models
docker exec ollama ollama list
```

### ChromaDB connection issues
```bash
# Check if ChromaDB is running
curl http://localhost:8000/api/v1/heartbeat

# Restart ChromaDB
docker-compose restart chromadb
```

### Login not working
```bash
# Check database
sqlite3 data/knowledge_base.db "SELECT * FROM users;"

# Reset admin password (in Python)
python -c "from rag_chatbot.auth import AuthManager; auth=AuthManager('data/knowledge_base.db'); auth.change_password(1, 'newpassword')"
```

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built on the foundation of RAG chatbot architecture
- Uses Ollama for local LLM inference
- ChromaDB for vector storage
- Sentence Transformers for embeddings

## 📞 Support

For issues and questions:
- Check [AWS_DEPLOYMENT_PLAN.md](AWS_DEPLOYMENT_PLAN.md) for deployment help
- Review existing GitHub issues
- Create new issue with detailed description

---

**Version**: 1.0  
**Last Updated**: November 2025

##### 3. Install `rag_chatbot` Package

```bash
uv sync --locked
```

### 2.3 Run

```bash
bash ./scripts/run.sh
```

or

```bash
uv run python -m rag_chatbot --host localhost
```

- Using Ngrok

```bash
bash ./scripts/run.sh --ngrok
```

### 3. Go to: `http://0.0.0.0:7860/` or Ngrok link after setup completed

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=datvodinh/rag-chatbot&type=Date)](https://star-history.com/#datvodinh/rag-chatbot&Date)
