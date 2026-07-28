"""
LLM Client - Ollama / OpenAI-Compatible API Client
Default model: dolphin-llama3:8b (Eric Hartford, based on Llama 3)

Fitur:
- Chat completion (OpenAI-compatible, jalan di Ollama /v1)
- Deteksi otomatis apakah model mendukung native tool calling.
  dolphin-llama3 memakai template ChatML tanpa dukungan tools, jadi
  agent akan otomatis fallback ke protokol JSON (lihat agent_loop.py).
- Health check yang ringan (list model, bukan generate token)
"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "dolphin-llama3:8b"
DEFAULT_BASE_URL = "http://ollama:11434/v1"

# Stop sequence bawaan template dolphin-llama3 (ChatML)
DEFAULT_STOP = ["<|im_start|>", "<|im_end|>"]


@dataclass
class ChatResponse:
    """Response standar dari LLM"""
    content: Optional[str] = None
    tool_calls: Optional[List[Any]] = None
    finish_reason: Optional[str] = None
    usage: Optional[Dict[str, int]] = field(default=None)


class LLMClient:
    """
    Client untuk Ollama (atau vLLM / server OpenAI-compatible lain).
    Dirancang untuk model dolphin-llama3:8b.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        api_key: str = "ollama",
        max_tokens: int = 2048,
        timeout: int = 600,
        num_ctx: Optional[int] = None,
    ):
        """
        Args:
            base_url: endpoint OpenAI-compatible (harus berakhiran /v1 untuk Ollama)
            model:    nama model, mis. "dolphin-llama3:8b"
            api_key:  bebas untuk Ollama (biasanya "ollama")
            max_tokens: batas token jawaban
            timeout:  timeout request (detik) - model lokal bisa lambat
            num_ctx:  context window (dipakai untuk varian :8b-256k)
        """
        self.model = model
        self.max_tokens = max_tokens
        self.num_ctx = num_ctx
        self.base_url = base_url.rstrip("/")

        # Root URL Ollama (tanpa /v1) untuk endpoint native seperti /api/tags
        self.ollama_root = self.base_url[:-3].rstrip("/") if self.base_url.endswith("/v1") else self.base_url

        # None = belum diketahui, True/False = hasil deteksi
        self.supports_tools: Optional[bool] = None

        self.client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=api_key or "ollama",
            timeout=httpx.Timeout(timeout, connect=10.0),
            max_retries=1,
        )

        logger.info("LLM Client init: model=%s endpoint=%s", model, self.base_url)

    # ──────────────────────────────────────────────────────────────
    # Chat
    # ──────────────────────────────────────────────────────────────
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict]] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stop: Optional[List[str]] = None,
    ) -> ChatResponse:
        """
        Minta jawaban dari LLM.

        Kalau `tools` diberikan tapi model tidak mendukung tool calling,
        request diulang otomatis tanpa `tools` dan `supports_tools`
        di-set False supaya pemanggil bisa pindah ke mode JSON.
        """
        params: Dict[str, Any] = {
            "model": self.model,
            "messages": self._sanitize(messages),
            "temperature": temperature,
            "max_tokens": max_tokens or self.max_tokens,
        }

        if stop:
            params["stop"] = stop

        if self.num_ctx:
            # Ollama menerima opsi tambahan lewat extra_body
            params["extra_body"] = {"options": {"num_ctx": self.num_ctx}}

        use_tools = bool(tools) and self.supports_tools is not False
        if use_tools:
            params["tools"] = tools
            params["tool_choice"] = "auto"

        try:
            response = await self.client.chat.completions.create(**params)
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            if use_tools and self._is_tool_unsupported_error(message):
                logger.warning(
                    "Model %s tidak mendukung native tool calling -> fallback ke mode JSON",
                    self.model,
                )
                self.supports_tools = False
                params.pop("tools", None)
                params.pop("tool_choice", None)
                response = await self.client.chat.completions.create(**params)
            else:
                logger.error("LLM API error: %s", message)
                raise RuntimeError(f"LLM request failed: {message}") from exc

        if use_tools and self.supports_tools is None:
            self.supports_tools = True

        choice = response.choices[0]
        tool_calls = getattr(choice.message, "tool_calls", None) or None

        usage = None
        if getattr(response, "usage", None):
            usage = {
                "prompt_tokens": response.usage.prompt_tokens or 0,
                "completion_tokens": response.usage.completion_tokens or 0,
                "total_tokens": response.usage.total_tokens or 0,
            }

        return ChatResponse(
            content=choice.message.content,
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason,
            usage=usage,
        )

    # ──────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────
    @staticmethod
    def _is_tool_unsupported_error(message: str) -> bool:
        low = message.lower()
        return (
            "does not support tools" in low
            or "does not support function" in low
            or "tools is not supported" in low
            or "tool calls" in low and "support" in low
        )

    @staticmethod
    def _sanitize(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Pastikan tidak ada content None (Ollama menolak null content)
        dan buang key kosong.
        """
        clean: List[Dict[str, Any]] = []
        for msg in messages:
            item = {k: v for k, v in msg.items() if v is not None}
            item.setdefault("content", "")
            if item.get("content") is None:
                item["content"] = ""
            clean.append(item)
        return clean

    # ──────────────────────────────────────────────────────────────
    # Health / model info
    # ──────────────────────────────────────────────────────────────
    async def health_check(self) -> bool:
        """Cek apakah server LLM hidup DAN model target sudah ter-pull."""
        try:
            models = await self.get_available_models()
        except Exception as exc:  # noqa: BLE001
            logger.error("Health check failed: %s", exc)
            return False

        if not models:
            return False

        target = self.model.lower()
        for name in models:
            n = name.lower()
            if n == target or n.startswith(target) or target.startswith(n.split(":")[0]):
                return True

        logger.warning(
            "Server LLM hidup tapi model '%s' belum ada. Model tersedia: %s",
            self.model,
            ", ".join(models) or "(kosong)",
        )
        return False

    async def server_alive(self) -> bool:
        """Cek koneksi ke server LLM saja (tanpa peduli model)."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.ollama_root}/api/tags")
                return resp.status_code == 200
        except Exception:  # noqa: BLE001
            try:
                await self.client.models.list()
                return True
            except Exception:  # noqa: BLE001
                return False

    async def get_available_models(self) -> List[str]:
        """Daftar model yang tersedia di server."""
        try:
            models = await self.client.models.list()
            return [m.id for m in models.data]
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to list models: %s", exc)
            return []

    async def ensure_model(self) -> Dict[str, Any]:
        """
        Info status model untuk endpoint /health.
        """
        alive = await self.server_alive()
        models = await self.get_available_models() if alive else []
        ready = False
        target = self.model.lower()
        for name in models:
            if name.lower().startswith(target) or target.startswith(name.lower().split(":")[0]):
                ready = True
                break
        return {
            "server_alive": alive,
            "model": self.model,
            "model_ready": ready,
            "available_models": models,
        }
