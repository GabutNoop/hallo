"""
Test REST + WebSocket end-to-end pada aplikasi FastAPI sungguhan,
dengan LLM dan Docker sandbox diganti fake (tanpa butuh Ollama/Docker).

Membuktikan rantai: chat (WS) -> backend -> agent -> tool sandbox -> jawaban.

Jalankan:  pytest backend/tests/test_api_ws.py -q
"""

import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main as main_module  # noqa: E402
from agent_loop import AgentLoop  # noqa: E402
from llm_client import ChatResponse  # noqa: E402
from tests.test_agent import FakeSandbox, FakeSearch  # noqa: E402


class ScriptedLLM:
    supports_tools = False

    def __init__(self, replies):
        self.replies = list(replies)

    async def chat_completion(self, messages, tools=None, temperature=0.7, **kwargs):
        content = self.replies.pop(0) if self.replies else json.dumps({"final_answer": "Selesai."})
        return ChatResponse(content=content, tool_calls=None, finish_reason="stop")

    async def ensure_model(self):
        return {
            "server_alive": True,
            "model": "dolphin-llama3:8b",
            "model_ready": True,
            "available_models": ["dolphin-llama3:8b"],
        }

    async def health_check(self):
        return True


class PatchedSandbox(FakeSandbox):
    def __init__(self):
        super().__init__()
        self.containers = {}

    def docker_available(self):
        return True

    async def create_sandbox(self, session_id=None):
        self.containers[session_id] = object()
        return session_id

    async def destroy_sandbox(self, session_id):
        self.containers.pop(session_id, None)
        return True

    async def destroy_all(self):
        self.containers.clear()

    def list_active_sessions(self):
        return [{"session_id": s, "status": "running"} for s in self.containers]

    async def get_container_info(self, session_id=None):
        return {"id": "fake123456", "status": "running"}


@pytest.fixture()
def client():
    replies = [
        json.dumps(
            {
                "thought": "cek sistem operasi sandbox",
                "action": "execute_in_sandbox",
                "action_input": {"command": "uname -s"},
            }
        ),
        json.dumps({"thought": "sudah dapat", "final_answer": "Sandbox berjalan di Linux (Ubuntu)."}),
    ]
    llm = ScriptedLLM(replies)
    sandbox = PatchedSandbox()
    search = FakeSearch()

    with TestClient(main_module.app) as c:
        st = main_module.state
        st.llm_client = llm
        st.sandbox_manager = sandbox
        st.search_tool = search
        st.agent = AgentLoop(llm, sandbox, search, max_retries=2)
        st.sessions.clear()
        st.connections.clear()
        yield c


def test_root_and_config(client):
    assert client.get("/").json()["name"] == "Autonomous AI Agent"
    assert client.get("/config").json()["model"]


def test_health_reports_llm_and_docker(client):
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert data["llm"]["healthy"] is True
    assert data["docker"]["healthy"] is True


def test_create_session_creates_sandbox(client):
    data = client.post("/sessions").json()
    assert data["sandbox"] is True
    assert data["sandbox_error"] is None
    assert data["session_id"]


def test_exec_endpoint_runs_in_sandbox(client):
    sid = client.post("/sessions").json()["session_id"]
    res = client.post(f"/sessions/{sid}/exec", json={"command": "echo hi"}).json()
    assert res["exit_code"] == 0
    assert "echo hi" in res["command"]


def test_websocket_chat_full_flow(client):
    sid = client.post("/sessions").json()["session_id"]

    with client.websocket_connect(f"/ws/{sid}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "session_ready"
        assert ready["sandbox"] is True

        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

        ws.send_json({"type": "task", "task": "OS apa yang dipakai sandbox?"})

        events = []
        for _ in range(40):
            event = ws.receive_json()
            events.append(event)
            if event["type"] in ("final_answer", "error"):
                break

    types = [e["type"] for e in events]
    assert "status" in types
    assert "tool_execution" in types, types
    assert types[-1] == "final_answer", events[-1]
    assert "Linux" in events[-1]["answer"]

    tool_events = [e for e in events if e["type"] == "tool_execution"]
    assert tool_events[0]["tool"] == "execute_in_sandbox"
    assert tool_events[0]["success"] is True


def test_websocket_rejects_empty_task(client):
    sid = client.post("/sessions").json()["session_id"]
    with client.websocket_connect(f"/ws/{sid}") as ws:
        ws.receive_json()
        ws.send_json({"type": "task", "task": "   "})
        assert ws.receive_json()["type"] == "error"


def test_rest_task_endpoint(client):
    sid = client.post("/sessions").json()["session_id"]
    data = client.post("/tasks", json={"session_id": sid, "task": "cek OS"}).json()
    assert data["answer"] and "Linux" in data["answer"]


def test_delete_session(client):
    sid = client.post("/sessions").json()["session_id"]
    assert client.delete(f"/sessions/{sid}").json()["status"] == "destroyed"
    assert client.get(f"/sessions/{sid}/status").status_code == 404
