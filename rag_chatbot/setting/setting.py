from pydantic import BaseModel, Field
from typing import List


class OpenRouterSettings(BaseModel):
    model: str = Field(default="qwen/qwen3-4b:free", description="OpenRouter model")
    api_key_file: str = Field(default="apikey.txt", description="API key file path")
    base_url: str = Field(default="https://openrouter.ai/api/v1", description="OpenRouter base URL")
    temperature: float = Field(default=0.1, description="Temperature")
    request_timeout: float = Field(default=300, description="Request timeout")
    context_window: int = Field(default=8000, description="Context window size")
    chat_token_limit: int = Field(default=4000, description="Chat memory limit")
    max_tokens: int = Field(default=2000, description="Maximum tokens to generate")


class OllamaSettings(BaseModel):
    llm: str = Field(default="qwen3:0.6b", description="LLM model")
    keep_alive: str = Field(default="1h", description="Keep alive time for the server")
    tfs_z: float = Field(default=1.0, description="TFS normalization factor")
    top_k: int = Field(default=40, description="Top k sampling")
    top_p: float = Field(default=0.9, description="Top p sampling")
    repeat_last_n: int = Field(default=64, description="Repeat last n tokens")
    repeat_penalty: float = Field(default=1.1, description="Repeat penalty")
    request_timeout: float = Field(default=300, description="Request timeout")
    port: int = Field(default=11434, description="Port number")
    context_window: int = Field(default=8000, description="Context window size")
    temperature: float = Field(default=0.1, description="Temperature")
    chat_token_limit: int = Field(default=4000, description="Chat memory limit")


class RetrieverSettings(BaseModel):
    num_queries: int = Field(default=5, description="Number of generated queries")
    similarity_top_k: int = Field(default=5, description="Top k documents")  # Reduced from 20 to 5 for speed
    retriever_weights: List[float] = Field(
        default=[0.4, 0.6], description="Weights for retriever"
    )
    top_k_rerank: int = Field(default=3, description="Top k rerank")  # Reduced from 6 to 3
    rerank_llm: str = Field(
        default="cross-encoder/ms-marco-MiniLM-L-6-v2", description="Rerank LLM model"
    )
    fusion_mode: str = Field(default="dist_based_score", description="Fusion mode")


class IngestionSettings(BaseModel):
    embed_llm: str = Field(
        default="BAAI/bge-small-en-v1.5", description="Embedding LLM model"
    )
    embed_batch_size: int = Field(default=32, description="Embedding batch size")
    cache_folder: str = Field(default="data/huggingface", description="Cache folder")
    chunk_size: int = Field(default=1024, description="Document chunk size")
    chunk_overlap: int = Field(default=128, description="Document chunk overlap")
    chunking_regex: str = Field(
        default="[^,.;。？！]+[,.;。？！]?", description="Chunking regex"
    )
    paragraph_sep: str = Field(default="\n \n", description="Paragraph separator")
    num_workers: int = Field(default=4, description="Number of workers")


class StorageSettings(BaseModel):
    persist_dir_chroma: str = Field(
        default="data/chroma", description="Chroma directory"
    )
    persist_dir_storage: str = Field(
        default="data/storage", description="Storage directory"
    )
    collection_name: str = Field(default="collection", description="Collection name")
    port: int = Field(default=8000, description="Port number")


class RAGSettings(BaseModel):
    openrouter: OpenRouterSettings = OpenRouterSettings()
    ollama: OllamaSettings = OllamaSettings()
    retriever: RetrieverSettings = RetrieverSettings()
    ingestion: IngestionSettings = IngestionSettings()
    storage: StorageSettings = StorageSettings()
