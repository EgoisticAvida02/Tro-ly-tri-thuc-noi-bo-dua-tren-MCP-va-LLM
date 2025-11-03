from llama_index.llms.ollama import Ollama
from llama_index.llms.openai import OpenAI
from llama_index.core.llms import CustomLLM, CompletionResponse, CompletionResponseGen, LLMMetadata
from llama_index.core.llms.callbacks import llm_completion_callback
from ...setting import RAGSettings
from dotenv import load_dotenv
import requests
import os
from typing import Any, Optional
from openai import OpenAI as OpenAIClient

load_dotenv()


class OpenRouterLLM(CustomLLM):
    """Custom LLM for OpenRouter API"""
    
    model: str = "qwen/qwen3-4b:free"
    api_key: str = ""
    base_url: str = "https://openrouter.ai/api/v1"
    temperature: float = 0.1
    max_tokens: int = 2000
    context_window: int = 8000
    
    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(
            context_window=self.context_window,
            num_output=self.max_tokens,
            model_name=self.model,
        )
    
    @llm_completion_callback()
    def complete(self, prompt: str, **kwargs: Any) -> CompletionResponse:
        client = OpenAIClient(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            extra_headers={
                "HTTP-Referer": "http://localhost:7860",
                "X-Title": "Internal Knowledge System"
            }
        )
        
        return CompletionResponse(text=response.choices[0].message.content)
    
    @llm_completion_callback()
    def stream_complete(self, prompt: str, **kwargs: Any) -> CompletionResponseGen:
        client = OpenAIClient(
            api_key=self.api_key,
            base_url=self.base_url,
        )
        
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            stream=True,
            extra_headers={
                "HTTP-Referer": "http://localhost:7860",
                "X-Title": "Internal Knowledge System"
            }
        )
        
        def gen():
            text = ""
            for chunk in response:
                if chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    text += delta
                    yield CompletionResponse(text=text, delta=delta)
        
        return gen()


class LocalRAGModel:
    def __init__(self) -> None:
        pass

    @staticmethod
    def _read_api_key(api_key_file: str) -> str:
        """Read API key from file"""
        try:
            with open(api_key_file, 'r') as f:
                return f.read().strip()
        except FileNotFoundError:
            raise ValueError(f"API key file not found: {api_key_file}")

    @staticmethod
    def set(
        model_name: str = "qwen/qwen3-4b:free",
        system_prompt: str | None = None,
        host: str = "localhost",
        setting: RAGSettings | None = None,
    ):
        setting = setting or RAGSettings()
        
        # Check if it's an OpenRouter model (contains "/" in format "provider/model")
        # OpenRouter: "qwen/qwen3-4b:free" or "anthropic/claude-3"
        # Ollama: "qwen2:latest" or "llama3:8b" (no slash)
        # GPT: "gpt-4" (no slash)
        if "/" in model_name:
            # Use custom OpenRouter LLM
            api_key = LocalRAGModel._read_api_key(setting.openrouter.api_key_file)
            return OpenRouterLLM(
                model=model_name,
                api_key=api_key,
                base_url=setting.openrouter.base_url,
                temperature=setting.openrouter.temperature,
                max_tokens=setting.openrouter.max_tokens,
                context_window=setting.openrouter.context_window,
            )
        elif model_name in ["gpt-3.5-turbo", "gpt-4", "gpt-4o", "gpt-4-turbo"]:
            # Use standard OpenAI
            return OpenAI(model=model_name, temperature=setting.ollama.temperature)
        else:
            # Use Ollama (including models like qwen2:latest, llama3:latest, etc.)
            settings_kwargs = {
                "tfs_z": setting.ollama.tfs_z,
                "top_k": setting.ollama.top_k,
                "top_p": setting.ollama.top_p,
                "repeat_last_n": setting.ollama.repeat_last_n,
                "repeat_penalty": setting.ollama.repeat_penalty,
            }
            return Ollama(
                model=model_name,
                system_prompt=system_prompt,
                base_url=f"http://{host}:{setting.ollama.port}",
                temperature=setting.ollama.temperature,
                context_window=setting.ollama.context_window,
                request_timeout=setting.ollama.request_timeout,
                additional_kwargs=settings_kwargs,
            )

    @staticmethod
    def pull(host: str, model_name: str):
        setting = RAGSettings()
        payload = {"name": model_name}
        return requests.post(
            f"http://{host}:{setting.ollama.port}/api/pull", json=payload, stream=True
        )

    @staticmethod
    def check_model_exist(host: str, model_name: str) -> bool:
        setting = RAGSettings()
        data = requests.get(f"http://{host}:{setting.ollama.port}/api/tags").json()
        if data["models"] is None:
            return False
        list_model = [d["name"] for d in data["models"]]
        if model_name in list_model:
            return True
        return False
