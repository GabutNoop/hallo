"""
FastAPI Main Entry Point
REST + WebSocket server untuk Autonomous AI Agent.

Protokol WebSocket (native WebSocket, BUKAN socket.io):
  URL: ws://<host>:8000/ws/{session_id}

  Client -> Server:
    {"type": "task",  "task": "..."}
    {"type": "cancel"}
    {"type": "ping"}

  Server -> Client:
    {"type": "session_ready", "session_id": "...", "message": "..."}
    {"type": "status", "state": "...", "message": "..."}
    {"type": "thought", "step": 1, "content": "..."}
    {"type": "tool_execution", ...}
    {"type": "final_answer", "answer": "...", "total_steps": n, "retries": n}
    {"type": "error", "message": "..."}
    {"type": "pong"}
"""

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent_loop import AgentLoop
from llm_client import LLMClient
from sandbox_manager import SandboxError, SandboxManager
from search_tool import SearchTool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("agent.main")

# ──────────────────────────────────────────────────────────────────────
# Konfigurasi
# ──────────────────────────────────────────────────────────────────────
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://ollama:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "dolphin-llama3:8b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
LLM_NUM_CTX = int(os.getenv("LLM_NUM_CTX", "0")) or None
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "2048"))

SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "ubuntu:22.04")
SANDBOX_MEMORY = os.getenv("SANDBOX_MEMORY", "2g")
SANDBOX_CPU = float(os.getenv("SANDBOX_CPU", "2.0"))
COMMAND_TIMEOUT = int(os.getenv("COMMAND_TIMEOUT", "120"))

MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))
MAX_STEPS = int(os.getenv("MAX_STEPS", "25"))
SEARCH_MAX_RESULTS = int(os.getenv("SEARCH_MAX_RESULTS", "5"))
SEARCH_TIMEOUT = int(os.getenv("SEARCH_TIMEOUT", "20"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]


# ──────────────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────────────
class AppState:
    sandbox_manager: Optional[SandboxManager] = None
    llm_client: Optional[LLMClient] = None
    search_tool: Optional[SearchTool] = None
    agent: Optional[AgentLoop] = None

    sessions: Dict[str, Dict[str, Any]] = {}
    connections: Dict[str, Set[WebSocket]] = {}
    running: Dict[str, asyncio.Task] = {}


state = AppState()


async def broadcast(session_id: str, payload: Dict[str, Any]):
    """Kirim event ke semua WebSocket yang terhubung pada session ini."""
    dead = []
    for ws in list(state.connections.get(session_id, set())):
        try:
            await ws.send_json(payload)
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for ws in dead:
        state.connections.get(session_id, set()).discard(ws)


# ──────────────────────────────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Menyalakan Autonomous AI Agent...")

    state.sandbox_manager = SandboxManager(
        image=SANDBOX_IMAGE,
        memory_limit=SANDBOX_MEMORY,
        cpu_limit=SANDBOX_CPU,
        command_timeout=COMMAND_TIMEOUT,
    )
    state.llm_client = LLMClient(
        base_url=LLM_BASE_URL,
        model=LLM_MODEL,
        api_key=LLM_API_KEY,
        max_tokens=LLM_MAX_TOKENS,
        num_ctx=LLM_NUM_CTX,
    )
    state.search_tool = SearchTool(max_results=SEARCH_MAX_RESULTS, timeout=SEARCH_TIMEOUT)
    state.agent = AgentLoop(
        llm_client=state.llm_client,
        sandbox_manager=state.sandbox_manager,
        search_tool=state.search_tool,
        max_retries=MAX_RETRIES,
        max_steps=MAX_STEPS,
    )

    if state.sandbox_manager.docker_available():
        logger.info("✅ Docker daemon terhubung (sandbox siap)")
    else:
        logger.warning("⚠️ Docker daemon TIDAK terhubung - mount /var/run/docker.sock")

    info = await state.llm_client.ensure_model()
    if info["model_ready"]:
        logger.info("✅ LLM siap: %s", LLM_MODEL)
    elif info["server_alive"]:
        logger.warning("⚠️ Ollama hidup tapi model '%s' belum ada. Jalankan ./pull-model.sh", LLM_MODEL)
    else:
        logger.warning("⚠️ Ollama belum bisa dihubungi di %s", LLM_BASE_URL)

    logger.info("✅ Backend siap di port %s", os.getenv("PORT", "8000"))
    yield

    logger.info("🛑 Shutdown...")
    for task in list(state.running.values()):
        task.cancel()
    try:
        await state.sandbox_manager.destroy_all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cleanup sandbox: %s", exc)
    logger.info("✅ Selesai")


app = FastAPI(
    title="Autonomous AI Agent",
    description="Self-correcting AI agent (dolphin-llama3:8b) dengan sandbox Docker",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────────────
class TaskRequest(BaseModel):
    task: str
    session_id: Optional[str] = None


class CommandRequest(BaseModel):
    command: str
    timeout: Optional[int] = None


# ──────────────────────────────────────────────────────────────────────
# REST
# ──────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "name": "Autonomous AI Agent",
        "version": "2.0.0",
        "model": LLM_MODEL,
        "endpoints": ["/health", "/config", "/sessions", "/ws/{session_id}"],
    }


@app.get("/config")
async def config():
    return {
        "model": LLM_MODEL,
        "llm_base_url": LLM_BASE_URL,
        "sandbox_image": SANDBOX_IMAGE,
        "max_retries": MAX_RETRIES,
        "max_steps": MAX_STEPS,
        "command_timeout": COMMAND_TIMEOUT,
    }


@app.get("/health")
async def health():
    llm_info = await state.llm_client.ensure_model()
    docker_ok = state.sandbox_manager.docker_available()

    healthy = llm_info["model_ready"] and docker_ok
    return {
        "status": "ok" if healthy else "degraded",
        "llm": {
            "healthy": llm_info["model_ready"],
            "server_alive": llm_info["server_alive"],
            "model": llm_info["model"],
            "available_models": llm_info["available_models"],
            "base_url": LLM_BASE_URL,
        },
        "docker": {"healthy": docker_ok, "image": SANDBOX_IMAGE},
        "active_sandboxes": len(state.sandbox_manager.containers),
        "active_sessions": len(state.sessions),
        "active_connections": sum(len(v) for v in state.connections.values()),
    }


@app.post("/sessions")
async def create_session():
    session_id = str(uuid.uuid4())
    sandbox_id, sandbox_error = None, None
    try:
        sandbox_id = await state.sandbox_manager.create_sandbox(session_id)
    except SandboxError as exc:
        sandbox_error = str(exc)
        logger.error("Sandbox gagal dibuat: %s", exc)

    state.sessions[session_id] = {
        "sandbox_id": sandbox_id,
        "status": "active" if sandbox_id else "no_sandbox",
        "sandbox_error": sandbox_error,
    }
    return {
        "session_id": session_id,
        "status": "created",
        "sandbox": bool(sandbox_id),
        "sandbox_error": sandbox_error,
        "model": LLM_MODEL,
    }


@app.get("/sessions")
async def list_sessions():
    return {
        "sessions": [
            {"session_id": sid, **info, "connections": len(state.connections.get(sid, set()))}
            for sid, info in state.sessions.items()
        ],
        "sandboxes": state.sandbox_manager.list_active_sessions(),
    }


@app.get("/sessions/{session_id}/status")
async def session_status(session_id: str):
    if session_id not in state.sessions:
        raise HTTPException(status_code=404, detail="Session tidak ditemukan")
    session = state.agent.get_session(session_id)
    if not session:
        return {"session_id": session_id, "state": "idle", "steps_count": 0}
    return {
        "session_id": session_id,
        "state": session.state.value,
        "steps_count": len(session.steps),
        "final_answer": session.final_answer,
        "error": session.error,
        "running": session_id in state.running,
    }


@app.get("/sessions/{session_id}/sandbox")
async def sandbox_info(session_id: str):
    return await state.sandbox_manager.get_container_info(session_id)


@app.post("/sessions/{session_id}/exec")
async def exec_command(session_id: str, body: CommandRequest):
    """Jalankan perintah manual di sandbox (untuk debugging dari UI/CLI)."""
    if session_id not in state.sessions:
        raise HTTPException(status_code=404, detail="Session tidak ditemukan")
    return await state.sandbox_manager.execute_command(
        body.command, session_id=session_id, timeout=body.timeout
    )


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    task = state.running.pop(session_id, None)
    if task:
        task.cancel()
    await state.sandbox_manager.destroy_sandbox(session_id)
    state.agent.cleanup_session(session_id)
    state.sessions.pop(session_id, None)
    state.connections.pop(session_id, None)
    return {"status": "destroyed", "session_id": session_id}


@app.post("/tasks")
async def run_task_rest(body: TaskRequest):
    """Jalankan task secara sinkron (fallback tanpa WebSocket)."""
    session_id = body.session_id or (await create_session())["session_id"]
    if session_id not in state.sessions:
        await ensure_session(session_id)

    events: List[Dict[str, Any]] = []
    async for update in state.agent.execute_task(session_id, body.task):
        events.append(update)
    answer = next((e["answer"] for e in reversed(events) if e.get("type") == "final_answer"), None)
    return {"session_id": session_id, "answer": answer, "events": events}


# ──────────────────────────────────────────────────────────────────────
# WebSocket
# ──────────────────────────────────────────────────────────────────────
async def ensure_session(session_id: str) -> Dict[str, Any]:
    if session_id in state.sessions and state.sessions[session_id].get("sandbox_id"):
        return state.sessions[session_id]

    sandbox_id, sandbox_error = None, None
    try:
        sandbox_id = await state.sandbox_manager.create_sandbox(session_id)
    except SandboxError as exc:
        sandbox_error = str(exc)
        logger.error("Sandbox gagal dibuat: %s", exc)

    state.sessions[session_id] = {
        "sandbox_id": sandbox_id,
        "status": "active" if sandbox_id else "no_sandbox",
        "sandbox_error": sandbox_error,
    }
    return state.sessions[session_id]


async def run_task(session_id: str, task: str):
    try:
        async for update in state.agent.execute_task(session_id, task):
            await broadcast(session_id, update)
            await asyncio.sleep(0.01)
    except asyncio.CancelledError:
        await broadcast(session_id, {"type": "status", "state": "cancelled", "message": "🛑 Task dibatalkan"})
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Task error: %s", exc)
        await broadcast(session_id, {"type": "error", "message": f"❌ Agent error: {exc}"})
    finally:
        state.running.pop(session_id, None)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    state.connections.setdefault(session_id, set()).add(websocket)
    logger.info("🔌 WS connect: session=%s", session_id)

    try:
        session_info = await ensure_session(session_id)

        await websocket.send_json(
            {
                "type": "session_ready",
                "session_id": session_id,
                "model": LLM_MODEL,
                "sandbox": bool(session_info.get("sandbox_id")),
                "message": (
                    "🟢 Session siap. Kirim tugasmu!"
                    if session_info.get("sandbox_id")
                    else f"⚠️ Sandbox tidak tersedia: {session_info.get('sandbox_error')}"
                ),
            }
        )

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "task":
                task = (data.get("task") or "").strip()
                if not task:
                    await websocket.send_json({"type": "error", "message": "❌ Task kosong"})
                    continue
                if session_id in state.running:
                    await websocket.send_json(
                        {"type": "error", "message": "⏳ Masih ada task berjalan. Tunggu atau kirim cancel."}
                    )
                    continue

                await broadcast(
                    session_id,
                    {"type": "status", "state": "starting", "message": f"🎯 Task diterima: {task[:120]}"},
                )
                state.running[session_id] = asyncio.create_task(run_task(session_id, task))

            elif msg_type == "cancel":
                state.agent.cancel(session_id)
                task_obj = state.running.get(session_id)
                if task_obj:
                    task_obj.cancel()
                await broadcast(
                    session_id, {"type": "status", "state": "cancelled", "message": "🛑 Task dibatalkan user"}
                )

            else:
                await websocket.send_json({"type": "error", "message": f"❌ Tipe pesan tidak dikenal: {msg_type}"})

    except WebSocketDisconnect:
        logger.info("🔌 WS disconnect: session=%s", session_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WS error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": f"❌ Connection error: {exc}"})
        except Exception:  # noqa: BLE001
            pass
    finally:
        state.connections.get(session_id, set()).discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("DEBUG", "false").lower() == "true",
        log_level="info",
    )
