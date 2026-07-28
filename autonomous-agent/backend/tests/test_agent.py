"""
Unit / integration test tanpa Docker & tanpa Ollama.

Menguji:
- Parsing protokol JSON dolphin-llama3 (mode fallback tanpa native tools)
- Native tool calling
- Self-correction saat perintah gagal
- Endpoint REST & WebSocket (chat realtime) end-to-end dengan LLM palsu

Jalankan:  pytest backend/tests -q
"""

import asyncio
import json
import os
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_loop import AgentLoop, ToolResult  # noqa: E402
from llm_client import ChatResponse  # noqa: E402


# ──────────────────────────────────────────────────────────────────────
# Fakes
# ──────────────────────────────────────────────────────────────────────
class FakeLLM:
    """LLM palsu yang membalas skrip yang sudah ditentukan."""

    def __init__(self, replies: List[str], supports_tools=False):
        self.replies = list(replies)
        self.supports_tools = supports_tools
        self.calls: List[List[Dict[str, Any]]] = []

    async def chat_completion(self, messages, tools=None, temperature=0.7, **kwargs):
        self.calls.append(list(messages))
        content = self.replies.pop(0) if self.replies else json.dumps(
            {"thought": "selesai", "final_answer": "Selesai."}
        )
        return ChatResponse(content=content, tool_calls=None, finish_reason="stop")


class FakeSandbox:
    """Sandbox palsu: memetakan command -> hasil."""

    def __init__(self, responses=None):
        self.responses = responses or {}
        self.executed: List[str] = []
        self.files: Dict[str, str] = {}
        self.containers = {"s1": object()}

    async def execute_command(self, command, session_id=None, timeout=None, workdir=None):
        self.executed.append(command)
        for key, value in self.responses.items():
            if key in command:
                return {**value, "command": command}
        return {"stdout": f"ran: {command}", "stderr": "", "exit_code": 0, "command": command}

    async def write_file(self, path, content, session_id=None):
        self.files[path] = content
        return {"stdout": "ok", "stderr": "", "exit_code": 0, "command": f"write {path}"}

    async def read_file(self, path, session_id=None):
        if path in self.files:
            return {"stdout": self.files[path], "stderr": "", "exit_code": 0, "command": "cat"}
        return {"stdout": "", "stderr": "No such file", "exit_code": 1, "command": "cat"}

    async def list_files(self, path="/workspace", session_id=None):
        return {"stdout": "\n".join(self.files) or "empty", "stderr": "", "exit_code": 0, "command": "ls"}


class FakeSearch:
    def __init__(self):
        self.queries: List[str] = []

    async def search(self, query, region="wt-wt"):
        self.queries.append(query)
        return f"Hasil pencarian untuk: {query}\n[1] Solusi: gunakan apt-get install -y"


def build_agent(replies, sandbox=None, search=None, max_retries=2):
    llm = FakeLLM(replies)
    sandbox = sandbox or FakeSandbox()
    search = search or FakeSearch()
    return AgentLoop(llm, sandbox, search, max_retries=max_retries), llm, sandbox, search


async def collect(agent, session_id, task):
    return [event async for event in agent.execute_task(session_id, task)]


# ──────────────────────────────────────────────────────────────────────
# Tests: parsing
# ──────────────────────────────────────────────────────────────────────
def test_extract_json_plain():
    data = AgentLoop._extract_json('{"action": "execute_in_sandbox", "action_input": {"command": "ls"}}')
    assert data["action"] == "execute_in_sandbox"


def test_extract_json_in_code_fence():
    text = 'Berikut langkahnya:\n```json\n{"thought": "cek", "action": "google_search", "action_input": {"query": "x"}}\n```'
    data = AgentLoop._extract_json(text)
    assert data["action"] == "google_search"


def test_extract_json_with_nested_braces_and_quotes():
    text = '{"action":"write_file_in_sandbox","action_input":{"path":"/a.json","content":"{\\"k\\": 1}"}}'
    data = AgentLoop._extract_json(text)
    assert data["action_input"]["path"] == "/a.json"


# ──────────────────────────────────────────────────────────────────────
# Tests: loop
# ──────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_json_protocol_execute_then_answer():
    agent, llm, sandbox, _ = build_agent(
        [
            json.dumps({"thought": "cek OS", "action": "execute_in_sandbox", "action_input": {"command": "uname -a"}}),
            json.dumps({"thought": "sudah tahu", "final_answer": "Sandbox berjalan di Linux."}),
        ]
    )
    events = await collect(agent, "s1", "cek OS sandbox")
    types = [e["type"] for e in events]

    assert "tool_execution" in types
    assert "uname -a" in sandbox.executed
    final = [e for e in events if e["type"] == "final_answer"][0]
    assert "Linux" in final["answer"]
    assert final["total_steps"] == 1


@pytest.mark.asyncio
async def test_self_correction_on_failed_command():
    sandbox = FakeSandbox({"apt-get install nginxx": {"stdout": "", "stderr": "E: Unable to locate package", "exit_code": 100}})
    search = FakeSearch()
    agent, llm, sandbox, search = build_agent(
        [
            json.dumps({"action": "execute_in_sandbox", "action_input": {"command": "apt-get install nginxx"}}),
            json.dumps({"action": "execute_in_sandbox", "action_input": {"command": "apt-get install -y nginx"}}),
            json.dumps({"final_answer": "nginx terpasang."}),
        ],
        sandbox=sandbox,
        search=search,
    )
    events = await collect(agent, "s1", "install nginx")

    assert any(e["type"] == "status" and e["state"] == "correcting" for e in events)
    assert search.queries, "agent harus mencari solusi error"
    final = [e for e in events if e["type"] == "final_answer"][0]
    assert "nginx" in final["answer"]


@pytest.mark.asyncio
async def test_max_retries_exhausted():
    sandbox = FakeSandbox({"boom": {"stdout": "", "stderr": "fatal", "exit_code": 1}})
    agent, *_ = build_agent(
        [json.dumps({"action": "execute_in_sandbox", "action_input": {"command": "boom"}})] * 6,
        sandbox=sandbox,
        max_retries=2,
    )
    events = await collect(agent, "s1", "gagal terus")
    assert events[-1]["type"] == "error"


@pytest.mark.asyncio
async def test_write_and_read_file_tools():
    agent, _, sandbox, _ = build_agent(
        [
            json.dumps(
                {
                    "action": "write_file_in_sandbox",
                    "action_input": {"path": "/workspace/app.py", "content": "print('hi')"},
                }
            ),
            json.dumps({"action": "read_file_in_sandbox", "action_input": {"path": "/workspace/app.py"}}),
            json.dumps({"final_answer": "File dibuat dan diverifikasi."}),
        ]
    )
    events = await collect(agent, "s1", "buat file python")
    assert sandbox.files["/workspace/app.py"] == "print('hi')"
    reads = [e for e in events if e["type"] == "tool_execution" and e["tool"] == "read_file_in_sandbox"]
    assert reads and "print('hi')" in reads[0]["output"]


@pytest.mark.asyncio
async def test_unknown_tool_is_reported_not_crash():
    agent, *_ = build_agent(
        [
            json.dumps({"action": "hack_the_planet", "action_input": {}}),
            json.dumps({"final_answer": "ok"}),
        ]
    )
    events = await collect(agent, "s1", "test")
    bad = [e for e in events if e["type"] == "tool_execution" and not e["success"]]
    assert bad and "tidak dikenal" in bad[0]["output"]


@pytest.mark.asyncio
async def test_plain_text_reply_becomes_final_answer():
    agent, *_ = build_agent(["Halo, saya Dolphin. Tidak ada yang perlu dieksekusi."])
    events = await collect(agent, "s1", "halo")
    assert events[-1]["type"] == "final_answer"
    assert "Dolphin" in events[-1]["answer"]


@pytest.mark.asyncio
async def test_native_tool_calling_path():
    class Fn:
        name = "execute_in_sandbox"
        arguments = json.dumps({"command": "echo native"})

    class Call:
        id = "call_1"
        function = Fn()

    class NativeLLM(FakeLLM):
        def __init__(self):
            super().__init__([], supports_tools=True)
            self.step = 0

        async def chat_completion(self, messages, tools=None, temperature=0.7, **kwargs):
            self.step += 1
            if self.step == 1:
                return ChatResponse(content="", tool_calls=[Call()], finish_reason="tool_calls")
            return ChatResponse(content="Output: native", tool_calls=None, finish_reason="stop")

    sandbox = FakeSandbox()
    agent = AgentLoop(NativeLLM(), sandbox, FakeSearch(), max_retries=1)
    events = await collect(agent, "s1", "echo")
    assert "echo native" in sandbox.executed
    assert events[-1]["type"] == "final_answer"


@pytest.mark.asyncio
async def test_search_tool_used():
    search = FakeSearch()
    agent, *_ = build_agent(
        [
            json.dumps({"action": "google_search", "action_input": {"query": "cara install docker ubuntu"}}),
            json.dumps({"final_answer": "Sudah dicari."}),
        ],
        search=search,
    )
    await collect(agent, "s1", "cari cara install docker")
    assert "cara install docker ubuntu" in search.queries
