from .core import (
    LocalChatEngine,
    LocalDataIngestion,
    LocalRAGModel,
    LocalEmbedding,
    LocalVectorStore,
    get_system_prompt,
)
from llama_index.core import Settings
from llama_index.core.chat_engine.types import StreamingAgentChatResponse
from llama_index.core.prompts import ChatMessage, MessageRole
from .setting import RAGSettings


class LocalRAGPipeline:
    def __init__(self, host: str = "localhost", auto_init_docs: bool = True) -> None:
        # Load settings
        self._settings = RAGSettings()
        self._host = host
        self._language = "eng"
        self._model_name = self._settings.ollama.llm  # Get from settings: llama3.2:3b
        self._system_prompt = get_system_prompt("eng", is_rag_prompt=False)
        self._engine = LocalChatEngine(host=host)
        self._default_model = LocalRAGModel.set(self._model_name, host=host)
        self._query_engine = None
        self._ingestion = LocalDataIngestion()
        self._vector_store = LocalVectorStore(host=host)
        Settings.llm = LocalRAGModel.set(self._model_name, host=host)
        # Defer embedding model loading until needed (when documents are uploaded)
        self._embed_model_loaded = False
        
        # Initialize query engine with existing documents if available
        if auto_init_docs:
            self._initialize_existing_documents()
    
    def _initialize_existing_documents(self):
        """Load existing documents from database and reprocess them on startup"""
        try:
            from rag_chatbot.database import document_manager
            import os
            
            # Get all documents from database
            docs = document_manager.get_all_documents()
            
            if docs and len(docs) > 0:
                print(f"Found {len(docs)} documents in database, loading...")
                # Documents exist, need to reprocess them
                self._ensure_embed_model()
                
                # Collect all file paths
                file_paths = []
                for doc in docs:
                    file_path = os.path.join("data/data", doc["filename"])
                    if os.path.exists(file_path):
                        file_paths.append(file_path)
                
                if file_paths:
                    print(f"Processing {len(file_paths)} files...")
                    # Process all documents at once
                    all_nodes = self._ingestion.store_nodes(
                        input_files=file_paths,
                        embed_nodes=True,
                        embed_model=Settings.embed_model
                    )
                    
                    if all_nodes:
                        print(f"Creating query engine with {len(all_nodes)} total nodes...")
                        # Create query engine with all nodes
                        self._query_engine = self._engine.set_engine(
                            llm=self._default_model,
                            nodes=all_nodes,
                            language=self._language
                        )
                        print("Query engine initialized successfully!")
        except Exception as e:
            print(f"Error initializing documents: {e}")
            import traceback
            traceback.print_exc()

    def _ensure_embed_model(self):
        """Load embedding model only when needed"""
        if not self._embed_model_loaded:
            Settings.embed_model = LocalEmbedding.set(host=self._host)
            self._embed_model_loaded = True

    def get_model_name(self):
        return self._model_name

    def set_model_name(self, model_name: str):
        self._model_name = model_name

    def get_language(self):
        return self._language

    def set_language(self, language: str):
        self._language = language

    def get_system_prompt(self):
        return self._system_prompt

    def set_system_prompt(self, system_prompt: str | None = None):
        self._system_prompt = system_prompt or get_system_prompt(
            language=self._language, is_rag_prompt=self._ingestion.check_nodes_exist()
        )

    def set_model(self):
        Settings.llm = LocalRAGModel.set(
            model_name=self._model_name,
            system_prompt=self._system_prompt,
            host=self._host,
        )
        self._default_model = Settings.llm

    def reset_engine(self):
        self._query_engine = self._engine.set_engine(
            llm=self._default_model, nodes=[], language=self._language
        )

    def reset_documents(self):
        self._ingestion.reset()

    def clear_conversation(self):
        if self._query_engine:
            self._query_engine.reset()

    def reset_conversation(self):
        self.reset_engine()
        self.set_system_prompt(
            get_system_prompt(language=self._language, is_rag_prompt=False)
        )

    def set_embed_model(self, model_name: str):
        Settings.embed_model = LocalEmbedding.set(model_name, self._host)

    def pull_model(self, model_name: str):
        return LocalRAGModel.pull(self._host, model_name)

    def pull_embed_model(self, model_name: str):
        return LocalEmbedding.pull(self._host, model_name)

    def check_exist(self, model_name: str) -> bool:
        return LocalRAGModel.check_model_exist(self._host, model_name)

    def check_exist_embed(self, model_name: str) -> bool:
        return LocalEmbedding.check_model_exist(self._host, model_name)

    def store_nodes(self, input_files: list[str] = None) -> None:
        # Load embedding model when documents are first uploaded
        self._ensure_embed_model()
        self._ingestion.store_nodes(input_files=input_files)

    def set_chat_mode(self, system_prompt: str | None = None):
        self.set_language(self._language)
        self.set_system_prompt(system_prompt)
        self.set_model()
        self.set_engine()

    def set_engine(self):
        self._query_engine = self._engine.set_engine(
            llm=self._default_model,
            nodes=self._ingestion.get_ingested_nodes(),
            language=self._language,
        )

    def get_history(self, chatbot: list[list[str]]):
        history = []
        for chat in chatbot:
            if chat[0]:
                history.append(ChatMessage(role=MessageRole.USER, content=chat[0]))
                history.append(ChatMessage(role=MessageRole.ASSISTANT, content=chat[1]))
        return history

    def query(
        self, mode: str, message: str, chatbot: list[list[str]]
    ) -> StreamingAgentChatResponse:
        import time
        
        if not self._query_engine:
            raise RuntimeError("No documents loaded. Please upload documents first in the Admin interface.")
        
        start = time.time()
        print(f"[PIPELINE] Starting query: '{message[:50]}...'")
        
        if mode == "chat":
            history = self.get_history(chatbot)
            result = self._query_engine.stream_chat(message, history)
        else:
            self._query_engine.reset()
            result = self._query_engine.stream_chat(message)
        
        print(f"[PIPELINE] Query engine returned in {time.time() - start:.2f}s")
        return result
