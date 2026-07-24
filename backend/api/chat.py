import json
import logging
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from backend.model import loader
from backend.config import DEFAULT_TEMPERATURE, MAX_TOKENS
from backend.utils.security_filter import scan_input, sanitize_text
from backend.utils.audit_log import log_request

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/api/chat")
async def chat(request: Request):
    data = await request.json()
    messages = data.get("messages") or data.get("history") or [{"role": "user", "content": data.get("message", "")}]
    temperature = float(data.get("temperature", DEFAULT_TEMPERATURE))
    max_tokens = int(data.get("max_tokens", MAX_TOKENS))
    stream = data.get("stream", True)

    # Filter defensif: scan pesan user
    user_content = data.get("message", "")
    for msg in messages:
        if msg.get("role") == "user" and msg.get("content"):
            user_content = msg.get("content", "")
    user_content = sanitize_text(user_content)
    scan_result = scan_input(user_content)
    if scan_result["blocked"]:
        log_request(user_content, f"blocked: {scan_result['reason']}", blocked=True)
        return StreamingResponse(
            (f'data: {json.dumps({"token": f"[BLOCKED: {scan_result[\"reason\"]} — input berbahaya tidak diizinkan]", "done": True, "total_tokens": 1})}\n\n' for _ in [1]),
            media_type="text/event-stream"
        )

    log_request(user_content, "allowed", blocked=False)

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
