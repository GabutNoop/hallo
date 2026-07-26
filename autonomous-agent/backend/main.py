"""
FastAPI Main Entry Point
WebSocket server for real-time communication between frontend and agent
"""

import os
import uuid
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent_loop import AgentLoop
from sandbox_manager import SandboxManager
from search_tool import SearchTool
from llm_client import LLMClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────
# Configuration from environment
# ──────────────────────────────────────────────────────────────────────
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://ollama:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "HauhauCS/Gemma4-12B-QAT-Uncensored-HauHauCS-Balanced")
LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")
SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "ubuntu:22.04")
SANDBOX_MEMORY = os.getenv("SANDBOX_MEMORY", "2g")
SANDBOX_CPU = float(os.getenv("SANDBOX_CPU", "2.0"))
COMMAND_TIMEOUT = int(os.getenv("COMMAND_TIMEOUT", "60"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))


# ──────────────────────────────────────────────────────────────────────
# Application State
# ──────────────────────────────────────────────────────────────────────
class AppState:
    """Global application state"""
    sandbox_manager: SandboxManager = None
    llm_client: LLMClient = None
    search_tool: SearchTool = None
    
    # Session management: session_id -> {agent, websocket, sandbox_id}
    sessions: Dict[str, Dict] = {}
    
    # Active websockets for broadcasting
    active_connections: Set[WebSocket] = set()


app_state = AppState()


# ──────────────────────────────────────────────────────────────────────
# Lifespan Events
# ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources"""
    # Startup
    logger.info("🚀 Starting Autonomous AI Agent System...")
    
    # Initialize components
    app_state.sandbox_manager = SandboxManager(
        image=SANDBOX_IMAGE,
        memory_limit=SANDBOX_MEMORY,
        cpu_limit=SANDBOX_CPU,
        command_timeout=COMMAND_TIMEOUT
    )
    
    app_state.llm_client = LLMClient(
        base_url=LLM_BASE_URL,
        model=LLM_MODEL,
        api_key=LLM_API_KEY
    )
    
    app_state.search_tool = SearchTool(max_results=5)
    
    # Health check
    if await app_state.llm_client.health_check():
        logger.info("✅ LLM service is healthy")
    else:
        logger.warning("⚠️ LLM service health check failed - check connection")
    
    logger.info("✅ System ready")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down...")
    await app_state.sandbox_manager.destroy_all()
    logger.info("✅ All sandboxes destroyed")


# ──────────────────────────────────────────────────────────────────────
# FastAPI App
# ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Autonomous AI Agent",
    description="Self-correcting AI agent with Docker sandbox execution",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────
# Request/Response Models
# ──────────────────────────────────────────────────────────────────────
class TaskRequest(BaseModel):
    task: str
    session_id: str = None


class SessionInfo(BaseModel):
    session_id: str
    sandbox_id: str = None
    status: str = "active"


# ──────────────────────────────────────────────────────────────────────
# REST API Endpoints
# ──────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    """System health check"""
    llm_healthy = await app_state.llm_client.health_check()
    sandbox_count = len(app_state.sandbox_manager.containers)
    
    return {
        "status": "ok" if llm_healthy else "degraded",
        "llm": "healthy" if llm_healthy else "unhealthy",
        "active_sandboxes": sandbox_count,
        "active_sessions": len(app_state.sessions)
    }


@app.post("/sessions")
async def create_session():
    """Create a new agent session with sandbox"""
    session_id = str(uuid.uuid4())
    
    # Create sandbox
    sandbox_id = await app_state.sandbox_manager.create_sandbox(session_id)
    
    # Create agent loop for this session
    agent = AgentLoop(
        llm_client=app_state.llm_client,
        sandbox_manager=app_state.sandbox_manager,
        search_tool=app_state.search_tool,
        max_retries=MAX_RETRIES
    )
    
    app_state.sessions[session_id] = {
        "agent": agent,
        "sandbox_id": sandbox_id,
        "status": "active"
    }
    
    return {"session_id": session_id, "status": "created"}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Destroy a session and its sandbox"""
    if session_id in app_state.sessions:
        await app_state.sandbox_manager.destroy_sandbox(session_id)
        del app_state.sessions[session_id]
        return {"status": "destroyed"}
    return {"status": "not_found"}


@app.get("/sessions/{session_id}/status")
async def get_session_status(session_id: str):
    """Get current status of an agent session"""
    if session_id not in app_state.sessions:
        return {"error": "Session not found"}
    
    agent = app_state.sessions[session_id]["agent"]
    session = agent.get_session(session_id)
    
    if session:
        return {
            "session_id": session_id,
            "state": session.state.value,
            "steps_count": len(session.steps),
            "final_answer": session.final_answer,
            "error": session.error
        }
    
    return {"session_id": session_id, "state": "idle"}


# ──────────────────────────────────────────────────────────────────────
# WebSocket Handler
# ──────────────────────────────────────────────────────────────────────
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time agent communication.
    Receives tasks from frontend and streams agent progress back.
    """
    await websocket.accept()
    app_state.active_connections.add(websocket)
    
    logger.info(f"🔌 WebSocket connected: session={session_id}")
    
    try:
        # Check if session exists, create if not
        if session_id not in app_state.sessions:
            sandbox_id = await app_state.sandbox_manager.create_sandbox(session_id)
            agent = AgentLoop(
                llm_client=app_state.llm_client,
                sandbox_manager=app_state.sandbox_manager,
                search_tool=app_state.search_tool,
                max_retries=MAX_RETRIES
            )
            app_state.sessions[session_id] = {
                "agent": agent,
                "sandbox_id": sandbox_id,
                "status": "active"
            }
        
        agent = app_state.sessions[session_id]["agent"]
        
        # Send session ready confirmation
        await websocket.send_json({
            "type": "session_ready",
            "session_id": session_id,
            "message": "🟢 Agent session ready. Send your task!"
        })
        
        while True:
            # Wait for task from client
            data = await websocket.receive_json()
            
            if data.get("type") == "task":
                task = data.get("task", "")
                
                if not task.strip():
                    await websocket.send_json({
                        "type": "error",
                        "message": "❌ Empty task received"
                    })
                    continue
                
                # Send acknowledgment
                await websocket.send_json({
                    "type": "status",
                    "state": "starting",
                    "message": f"🎯 Task received: {task[:100]}..."
                })
                
                # Execute agent loop and stream results
                async for update in agent.execute_task(session_id, task):
                    await websocket.send_json(update)
                    
                    # Small delay to prevent overwhelming the client
                    await asyncio.sleep(0.05)
            
            elif data.get("type") == "cancel":
                # Handle task cancellation
                await websocket.send_json({
                    "type": "status",
                    "state": "cancelled",
                    "message": "🛑 Task cancelled by user"
                })
            
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnected: session={session_id}")
    except Exception as e:
        logger.exception(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"❌ Connection error: {str(e)}"
            })
        except Exception:
            pass
    finally:
        app_state.active_connections.discard(websocket)


# ──────────────────────────────────────────────────────────────────────
# Run Server
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=os.getenv("DEBUG", "false").lower() == "true",
        log_level="info"
    )
