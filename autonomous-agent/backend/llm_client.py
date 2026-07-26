"""
LLM Client - Ollama / OpenAI-Compatible API Client
Handles communication with the language model
"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from openai import AsyncOpenAI
import httpx

logger = logging.getLogger(__name__)


@dataclass
class ChatResponse:
    """Standardized response from LLM"""
    content: Optional[str]
    tool_calls: Optional[List[Any]] = None
    finish_reason: Optional[str] = None
    usage: Optional[Dict[str, int]] = None


class LLMClient:
    """
    Client for communicating with Ollama or vLLM via OpenAI-compatible API.
    Designed for the HauhauCS/Gemma4-12B-QAT-Uncensored model.
    """
    
    def __init__(
        self,
        base_url: str = "http://localhost:11434/v1",
        model: str = "HauhauCS/Gemma4-12B-QAT-Uncensored-HauHauCS-Balanced",
        api_key: str = "ollama",
        max_tokens: int = 8192,
        timeout: int = 300
    ):
        """
        Initialize LLM Client.
        
        Args:
            base_url: OpenAI-compatible API endpoint
            model: Model name/identifier
            api_key: API key (often just "ollama" for local instances)
            max_tokens: Maximum response tokens
            timeout: Request timeout in seconds
        """
        self.model = model
        self.max_tokens = max_tokens
        
        # Create async OpenAI client pointing to Ollama/vLLM
        self.client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=httpx.Timeout(timeout, connect=10.0),
            max_retries=2
        )
        
        logger.info(f"LLM Client initialized: model={model}, endpoint={base_url}")
    
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict]] = None,
        temperature: float = 0.7,
        max_tokens: int = None,
        stop: Optional[List[str]] = None
    ) -> ChatResponse:
        """
        Get a chat completion from the LLM.
        
        Args:
            messages: Conversation messages
            tools: Available tool definitions for function calling
            temperature: Sampling temperature
            max_tokens: Override default max tokens
            stop: Stop sequences
            
        Returns:
            ChatResponse with content and/or tool calls
        """
        try:
            # Build request parameters
            params = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens or self.max_tokens,
            }
            
            # Add tool definitions if available
            if tools:
                params["tools"] = tools
                params["tool_choice"] = "auto"
            
            # Add stop sequences if provided
            if stop:
                params["stop"] = stop
            
            # Make API call
            response = await self.client.chat.completions.create(**params)
            
            # Parse response
            choice = response.choices[0]
            
            # Extract tool calls if present
            tool_calls = None
            if choice.message.tool_calls:
                tool_calls = choice.message.tool_calls
            
            return ChatResponse(
                content=choice.message.content,
                tool_calls=tool_calls,
                finish_reason=choice.finish_reason,
                usage={
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                    "total_tokens": response.usage.total_tokens if response.usage else 0,
                } if response.usage else None
            )
            
        except Exception as e:
            logger.error(f"LLM API error: {e}")
            raise RuntimeError(f"LLM request failed: {str(e)}")
    
    async def health_check(self) -> bool:
        """
        Check if the LLM service is available.
        
        Returns:
            True if healthy
        """
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5
            )
            return response is not None
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
    
    async def get_available_models(self) -> List[str]:
        """
        List available models from the API.
        
        Returns:
            List of model names
        """
        try:
            models = await self.client.models.list()
            return [model.id for model in models.data]
        except Exception as e:
            logger.error(f"Failed to list models: {e}")
            return []
