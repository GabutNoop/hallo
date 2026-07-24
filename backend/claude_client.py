import os
import json
import logging
import aiohttp
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class ClaudeAPIClient:
    def __init__(self):
        self.api_token = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
        self.base_url = os.getenv("ANTHROPIC_BASE_URL", "https://ai.bluepack.my.id/anthropic")
        self.timeout = int(os.getenv("API_TIMEOUT_MS", "3000000")) / 1000
        self.enabled = bool(self.api_token) and os.getenv("USE_CLAUDE_API", "false").lower() == "true"

    async def generate(self, messages: List[Dict[str, Any]], temperature: float = 0.7, max_tokens: int = 2048) -> str:
        if not self.enabled:
            return "(Claude API tidak aktif. Set USE_CLAUDE_API=true dan isi ANTHROPIC_AUTH_TOKEN)"
        try:
            payload = {
                "model": "claude-3-opus-20240229",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": messages
            }
            headers = {
                "Content-Type": "application/json",
                "x-api-key": self.api_token,
                "anthropic-version": "2023-06-01"
            }
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/v1/messages",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=self.timeout)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("content", [{}])[0].get("text", "") if isinstance(data.get("content"), list) else data.get("content", [])[0].get("text", data.get("completion", ""))
                    else:
                        text = await resp.text()
                        return f"Claude API error {resp.status}: {text}"
        except Exception as e:
            logger.error(f"Claude API error: {e}")
            return f"Claude API error: {e}"

claude_client = ClaudeAPIClient()
