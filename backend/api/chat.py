import json
import logging
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from backend.model import loader
from backend.config import DEFAULT_TEMPERATURE, MAX_TOKENS

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/api/chat")
async def chat(request: Request):
    data = await request.json()
    messages = data.get("messages") or data.get("history") or [{"role": "user", "content": data.get("message", "")}]
    temperature = float(data.get("temperature", DEFAULT_TEMPERATURE))
    max_tokens = int(data.get("max_tokens", MAX_TOKENS))
    stream = data.get("stream", True)

    async def event_stream():
        await loader.load()
        response_text = await loader.generate(messages, temperature=temperature, max_tokens=max_tokens, stream=stream)
        if stream:
            tokens = response_text.split()
            for i, token in enumerate(tokens):
                chunk = json.dumps({"token": token + " ", "done": False, "total_tokens": len(tokens)})
                yield f"data: {chunk}\n\n"
            final_data = json.dumps({"token": "", "done": True, "total_tokens": len(tokens)})
            yield f"data: {final_data}\n\n"
        else:
            chunk = json.dumps({"token": response_text, "done": True, "total_tokens": len(response_text.split())})
            yield f"data: {chunk}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
