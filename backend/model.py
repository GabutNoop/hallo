import os
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

from backend.claude_client import claude_client

class ModelLoader:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.pipe = None
        self.loaded = False
        self.model_name = "gemma-4-31b-it-uncensored"

    async def load(self):
        try:
            import torch
            from transformers import pipeline, AutoModelForCausalLM, AutoTokenizer
            logger.info("Attempting to load model from transformers...")
            model_path = "/home/user/chatbot/models/gemma-4-31b"
            if os.path.exists(model_path) and os.listdir(model_path):
                self.tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
                self.model = AutoModelForCausalLM.from_pretrained(model_path, trust_remote_code=True, torch_dtype=torch.float16)
                self.pipe = pipeline("text-generation", model=self.model, tokenizer=self.tokenizer, device_map="auto")
            else:
                logger.info("Local model not found. Falling back to dummy response mode.")
                self.loaded = True
            self.loaded = True
        except Exception as e:
            logger.error(f"Model load failed: {e}")
            self.loaded = True

    async def generate(self, messages: List[Dict[str, Any]], temperature: float = 0.7, max_tokens: int = 2048, stream: bool = True) -> Any:
        # Versi Apikey: coba Claude API jika diaktifkan atau model lokal tidak tersedia
        if os.getenv("USE_CLAUDE_API", "false").lower() == "true" or not self.pipe:
            if claude_client.enabled or os.getenv("USE_CLAUDE_API", "false").lower() == "true":
                result = await claude_client.generate(messages, temperature=temperature, max_tokens=max_tokens)
                return result
        prompt = self._format_messages(messages)
        try:
            if self.pipe:
                result = self.pipe(prompt, max_new_tokens=max_tokens, temperature=temperature, return_full_text=False)
                text = result[0]["generated_text"] if isinstance(result, list) else result
                return text
            else:
                return f"(Dummy response for '{prompt[:50]}...') The model server is not fully loaded. This is a sandbox/demo environment with limited resources."
        except Exception as e:
            logger.error(f"Generation error: {e}")
            return f"Error during generation: {e}"

    def _format_messages(self, messages: List[Dict[str, Any]]) -> str:
        text = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            text += f"{role}: {content}\n"
        return text

loader = ModelLoader()
