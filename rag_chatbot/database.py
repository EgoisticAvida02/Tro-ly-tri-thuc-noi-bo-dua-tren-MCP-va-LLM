"""
Database models for the internal knowledge system
"""
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional
from pathlib import Path


class Database:
    """Database handler for the knowledge system"""
    
    def __init__(self, db_path: str = "data/knowledge_system.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_database()
    
    def get_connection(self):
        """Get database connection"""
        return sqlite3.connect(self.db_path)
    
    def init_database(self):
        """Initialize database tables"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Documents table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                uploaded_by TEXT DEFAULT 'admin',
                status TEXT DEFAULT 'active',
                metadata TEXT
            )
        """)
        
        # User reports table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT,
                report_type TEXT NOT NULL,
                report_reason TEXT,
                user_comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                resolved_at TIMESTAMP,
                resolved_by TEXT,
                resolution_notes TEXT
            )
        """)
        
        # Chat history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                user_id INTEGER,
                user_type TEXT DEFAULT 'user',
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                sources TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        
        # Migrate existing chat_history table if user_id column doesn't exist
        self._migrate_chat_history_table(cursor)
        
        conn.commit()
        conn.close()
    
    def _migrate_chat_history_table(self, cursor):
        """Add user_id column to chat_history if it doesn't exist"""
        try:
            # Check if user_id column exists
            cursor.execute("PRAGMA table_info(chat_history)")
            columns = [column[1] for column in cursor.fetchall()]
            
            if 'user_id' not in columns:
                print("Migrating chat_history table to add user_id column...")
                # Add user_id column (SQLite allows adding nullable columns)
                cursor.execute("ALTER TABLE chat_history ADD COLUMN user_id INTEGER")
                print("✓ Migration completed: user_id column added to chat_history")
        except Exception as e:
            print(f"Migration note: {e}")


class DocumentManager:
    """Manager for document operations"""
    
    def __init__(self, db: Database):
        self.db = db
    
    def add_document(
        self,
        filename: str,
        original_filename: str,
        file_type: str,
        file_size: int,
        uploaded_by: str = "admin",
        metadata: Optional[Dict] = None
    ) -> int:
        """Add a new document to the database"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO documents 
            (filename, original_filename, file_type, file_size, uploaded_by, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            filename,
            original_filename,
            file_type,
            file_size,
            uploaded_by,
            json.dumps(metadata) if metadata else None
        ))
        
        doc_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return doc_id
    
    def get_all_documents(self) -> List[Dict]:
        """Get all documents"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM documents 
            WHERE status = 'active'
            ORDER BY upload_date DESC
        """)
        
        documents = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return documents
    
    def delete_document(self, doc_id: int) -> bool:
        """Soft delete a document"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE documents 
            SET status = 'deleted'
            WHERE id = ?
        """, (doc_id,))
        
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        
        return success
    
    def get_document(self, doc_id: int) -> Optional[Dict]:
        """Get a specific document"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
        row = cursor.fetchone()
        conn.close()
        
        return dict(row) if row else None


class ReportManager:
    """Manager for user report operations"""
    
    def __init__(self, db: Database):
        self.db = db
    
    def create_report(
        self,
        question: str,
        answer: str,
        report_type: str,
        report_reason: str,
        user_comment: Optional[str] = None
    ) -> int:
        """Create a new user report"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO user_reports 
            (question, answer, report_type, report_reason, user_comment)
            VALUES (?, ?, ?, ?, ?)
        """, (question, answer, report_type, report_reason, user_comment))
        
        report_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return report_id
    
    def get_all_reports(self, status: Optional[str] = None) -> List[Dict]:
        """Get all reports, optionally filtered by status"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        if status:
            cursor.execute("""
                SELECT * FROM user_reports 
                WHERE status = ?
                ORDER BY created_at DESC
            """, (status,))
        else:
            cursor.execute("""
                SELECT * FROM user_reports 
                ORDER BY created_at DESC
            """)
        
        reports = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return reports
    
    def resolve_report(
        self,
        report_id: int,
        resolved_by: str,
        resolution_notes: Optional[str] = None
    ) -> bool:
        """Mark a report as resolved"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE user_reports 
            SET status = 'resolved',
                resolved_at = CURRENT_TIMESTAMP,
                resolved_by = ?,
                resolution_notes = ?
            WHERE id = ?
        """, (resolved_by, resolution_notes, report_id))
        
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        
        return success
    
    def get_report(self, report_id: int) -> Optional[Dict]:
        """Get a specific report"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM user_reports WHERE id = ?", (report_id,))
        row = cursor.fetchone()
        conn.close()
        
        return dict(row) if row else None


class ChatHistoryManager:
    """Manager for chat history operations"""
    
    def __init__(self, db: Database):
        self.db = db
    
    def add_chat(
        self,
        session_id: str,
        question: str,
        answer: str,
        sources: Optional[List[Dict]] = None,
        user_type: str = "user",
        user_id: Optional[int] = None
    ) -> int:
        """Add a chat interaction to history"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO chat_history 
            (session_id, user_id, user_type, question, answer, sources)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            user_id,
            user_type,
            question,
            answer,
            json.dumps(sources) if sources else None
        ))
        
        chat_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return chat_id
    
    def get_session_history(self, session_id: str) -> List[Dict]:
        """Get chat history for a session"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM chat_history 
            WHERE session_id = ?
            ORDER BY created_at ASC
        """, (session_id,))
        
        history = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return history
    
    def get_chat_count(self) -> int:
        """Get total number of chats"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM chat_history")
        count = cursor.fetchone()[0]
        conn.close()
        
        return count
    
    def get_user_history(self, user_id: int) -> List[Dict]:
        """Get all chat history for a specific user"""
        conn = self.db.get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM chat_history 
            WHERE user_id = ?
            ORDER BY created_at DESC
        """, (user_id,))
        
        history = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return history
    
    def get_user_chat_count(self, user_id: int) -> int:
        """Get total number of chats for a specific user"""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM chat_history WHERE user_id = ?", (user_id,))
        count = cursor.fetchone()[0]
        conn.close()
        
        return count


# Initialize global database instance
db = Database()
document_manager = DocumentManager(db)
report_manager = ReportManager(db)
chat_history_manager = ChatHistoryManager(db)
