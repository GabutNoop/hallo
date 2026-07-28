"""
Autonomous AI Agent - Self-Correcting ReAct Loop

Mendukung dua mode pemanggilan tool:
1. Native OpenAI tool calling (kalau model/server mendukung)
2. Protokol JSON (fallback) -> dipakai oleh dolphin-llama3:8b yang
   memakai template ChatML tanpa dukungan `tools`.

Event yang di-stream ke frontend (lewat WebSocket):
  {"type": "status",         "state": ..., "message": ...}
  {"type": "thought",        "step": n, "content": ...}
  {"type": "tool_execution", "step": n, "tool": ..., "input": ..., "output": ...}
  {"type": "final_answer",   "answer": ..., "total_steps": n, "retries": n}
  {"type": "error",          "message": ...}
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional

from llm_client import LLMClient
from sandbox_manager import SandboxManager
from search_tool import SearchTool

logger = logging.getLogger(__name__)


class ActionType(str, Enum):
    GOOGLE_SEARCH = "google_search"
    EXECUTE_IN_SANDBOX = "execute_in_sandbox"
    WRITE_FILE_IN_SANDBOX = "write_file_in_sandbox"
    READ_FILE_IN_SANDBOX = "read_file_in_sandbox"
    LIST_FILES_IN_SANDBOX = "list_files_in_sandbox"
    FINAL_ANSWER = "final_answer"


class AgentState(str, Enum):
    IDLE = "idle"
    REASONING = "reasoning"
    SEARCHING = "searching"
    EXECUTING = "executing"
    OBSERVING = "observing"
    CORRECTING = "correcting"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ToolResult:
    success: bool
    output: str
    error: Optional[str] = None
    exit_code: Optional[int] = None


@dataclass
class AgentStep:
    step_number: int
    action_type: str
    thought: str
    tool_input: Dict[str, Any]
    tool_output: Optional[ToolResult] = None
    is_retry: bool = False
    retry_count: int = 0


@dataclass
class AgentSession:
    session_id: str
    task: str
    state: AgentState = AgentState.IDLE
    steps: List[AgentStep] = field(default_factory=list)
    history: List[Dict[str, Any]] = field(default_factory=list)
    final_answer: Optional[str] = None
    error: Optional[str] = None
    cancelled: bool = False


# ──────────────────────────────────────────────────────────────────────
# Definisi tool (dipakai untuk native tool calling)
# ──────────────────────────────────────────────────────────────────────
TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "google_search",
            "description": "Cari informasi terbaru di web (DuckDuckGo). Gunakan untuk panduan instalasi, dokumentasi API, atau solusi error.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Kata kunci pencarian"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_in_sandbox",
            "description": "Jalankan perintah shell (bash) di sandbox Docker Ubuntu dengan akses root.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string", "description": "Perintah shell"}},
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file_in_sandbox",
            "description": "Tulis/timpa file di sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path absolut file"},
                    "content": {"type": "string", "description": "Isi file"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file_in_sandbox",
            "description": "Baca isi file dari sandbox.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Path absolut file"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files_in_sandbox",
            "description": "Daftar isi direktori di sandbox.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Path direktori"}},
                "required": ["path"],
            },
        },
    },
]

VALID_TOOLS = {t["function"]["name"] for t in TOOL_SCHEMAS}

MAX_OBSERVATION_CHARS = 6000


class AgentLoop:
    """Self-correcting agentic loop."""

    def __init__(
        self,
        llm_client: LLMClient,
        sandbox_manager: SandboxManager,
        search_tool: SearchTool,
        max_retries: int = 5,
        max_steps: int = 25,
    ):
        self.llm = llm_client
        self.sandbox = sandbox_manager
        self.search = search_tool
        self.max_retries = max_retries
        self.max_steps = max_steps
        self.tools = TOOL_SCHEMAS
        self.sessions: Dict[str, AgentSession] = {}

    # ──────────────────────────────────────────────────────────────
    # Main loop
    # ──────────────────────────────────────────────────────────────
    async def execute_task(self, session_id: str, task: str) -> AsyncIterator[Dict[str, Any]]:
        session = self.sessions.get(session_id)
        if session is None or session.final_answer or session.state in (
            AgentState.COMPLETED,
            AgentState.FAILED,
        ):
            session = AgentSession(session_id=session_id, task=task)
            self.sessions[session_id] = session
        else:
            session.task = task
            session.error = None

        session.cancelled = False
        session.state = AgentState.REASONING
        session.final_answer = None

        history = session.history
        if not history:
            history.append({"role": "system", "content": self._system_prompt()})
        history.append({"role": "user", "content": f"TUGAS: {task}"})

        retries = 0

        try:
            yield self._status("reasoning", "🧠 Menganalisis tugas dan menyusun rencana...")

            for _ in range(self.max_steps):
                if session.cancelled:
                    session.state = AgentState.IDLE
                    yield self._status("cancelled", "🛑 Task dibatalkan.")
                    return

                step_number = len(session.steps) + 1
                yield self._status("reasoning", f"🧠 Langkah {step_number}: AI sedang berpikir...")

                try:
                    response = await self.llm.chat_completion(
                        messages=history,
                        tools=self.tools if self.llm.supports_tools is not False else None,
                        temperature=0.2 if retries > 0 else 0.5,
                    )
                except Exception as exc:  # noqa: BLE001
                    session.state = AgentState.FAILED
                    session.error = str(exc)
                    yield {"type": "error", "message": f"❌ Gagal menghubungi LLM: {exc}"}
                    return

                actions, thought, final_answer = self._parse_response(response)

                if thought:
                    yield {"type": "thought", "step": step_number, "content": thought}

                # ── Tidak ada tool call -> jawaban akhir ────────────
                if not actions:
                    answer = final_answer or thought or (response.content or "").strip()
                    if not answer:
                        answer = "Tidak ada jawaban yang dihasilkan model."
                    history.append({"role": "assistant", "content": answer})
                    session.state = AgentState.COMPLETED
                    session.final_answer = answer
                    yield {
                        "type": "final_answer",
                        "answer": answer,
                        "total_steps": len(session.steps),
                        "retries": retries,
                    }
                    return

                # ── Eksekusi tiap action ───────────────────────────
                for action in actions:
                    if session.cancelled:
                        session.state = AgentState.IDLE
                        yield self._status("cancelled", "🛑 Task dibatalkan.")
                        return

                    name = action["name"]
                    args = action["arguments"]
                    call_id = action.get("id") or f"call_{step_number}"

                    if name == ActionType.FINAL_ANSWER.value:
                        answer = str(args.get("answer") or thought or "Selesai.")
                        session.state = AgentState.COMPLETED
                        session.final_answer = answer
                        history.append({"role": "assistant", "content": answer})
                        yield {
                            "type": "final_answer",
                            "answer": answer,
                            "total_steps": len(session.steps),
                            "retries": retries,
                        }
                        return

                    if name not in VALID_TOOLS:
                        observation = (
                            f"ERROR: tool '{name}' tidak dikenal. "
                            f"Tool yang tersedia: {', '.join(sorted(VALID_TOOLS))}."
                        )
                        history.append({"role": "user", "content": f"OBSERVATION:\n{observation}"})
                        yield {
                            "type": "tool_execution",
                            "step": step_number,
                            "tool": name,
                            "input": args,
                            "output": observation,
                            "success": False,
                            "is_retry": retries > 0,
                            "retry_count": retries,
                        }
                        continue

                    yield self._status(
                        "searching" if name == "google_search" else "executing",
                        f"{self._tool_emoji(name)} {self._describe(name, args)}",
                    )

                    result = await self._execute_tool(name, args, session_id)

                    step = AgentStep(
                        step_number=step_number,
                        action_type=name,
                        thought=thought,
                        tool_input=args,
                        tool_output=result,
                        is_retry=retries > 0,
                        retry_count=retries,
                    )
                    session.steps.append(step)

                    output_text = result.output if result.success else (result.error or result.output)
                    yield {
                        "type": "tool_execution",
                        "step": step_number,
                        "tool": name,
                        "input": args,
                        "output": output_text[:MAX_OBSERVATION_CHARS],
                        "success": result.success,
                        "exit_code": result.exit_code,
                        "is_retry": retries > 0,
                        "retry_count": retries,
                    }

                    # Catat ke history
                    self._append_call(history, response, action, call_id)
                    observation = self._format_observation(result)
                    self._append_observation(history, observation, call_id)

                    # ── Self-correction ────────────────────────────
                    if not result.success and name in (
                        "execute_in_sandbox",
                        "write_file_in_sandbox",
                        "read_file_in_sandbox",
                        "list_files_in_sandbox",
                    ):
                        if retries >= self.max_retries:
                            session.state = AgentState.FAILED
                            session.error = f"Gagal setelah {self.max_retries} percobaan"
                            yield {
                                "type": "error",
                                "message": f"❌ Task gagal setelah {self.max_retries} kali self-correction",
                                "error": (result.error or result.output)[:2000],
                            }
                            return

                        retries += 1
                        session.state = AgentState.CORRECTING
                        yield self._status(
                            "correcting",
                            f"🔧 Error terdeteksi. Self-correcting ({retries}/{self.max_retries})...",
                        )

                        err = (result.error or result.output or "unknown error").strip()
                        query = f"how to fix: {err[:180]}"
                        yield self._status("searching", f"🔍 Mencari solusi: {query[:100]}")

                        search_result = await self.search.search(query)
                        yield {
                            "type": "tool_execution",
                            "step": step_number,
                            "tool": "google_search",
                            "input": {"query": query},
                            "output": search_result[:MAX_OBSERVATION_CHARS],
                            "success": True,
                            "is_retry": True,
                            "retry_count": retries,
                        }

                        history.append(
                            {
                                "role": "user",
                                "content": (
                                    f"Perintah sebelumnya GAGAL:\n{err[:1500]}\n\n"
                                    f"Hasil pencarian solusi:\n{search_result[:2500]}\n\n"
                                    "Analisis penyebabnya lalu coba pendekatan lain."
                                ),
                            }
                        )

                    await asyncio.sleep(0.05)

            session.state = AgentState.FAILED
            session.error = "Batas langkah tercapai"
            yield {
                "type": "error",
                "message": f"❌ Task belum selesai dalam {self.max_steps} langkah.",
            }

        except Exception as exc:  # noqa: BLE001
            logger.exception("Agent loop error: %s", exc)
            session.state = AgentState.FAILED
            session.error = str(exc)
            yield {"type": "error", "message": f"❌ Agent error: {exc}"}

    # ──────────────────────────────────────────────────────────────
    # Parsing response
    # ──────────────────────────────────────────────────────────────
    def _parse_response(self, response) -> (List[Dict[str, Any]], str, Optional[str]):
        """
        Kembalikan (actions, thought, final_answer).
        Mendukung native tool_calls maupun JSON di dalam content.
        """
        thought = (response.content or "").strip()

        # 1) Native tool calls
        if response.tool_calls:
            actions = []
            for call in response.tool_calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {"_raw": call.function.arguments}
                if not isinstance(args, dict):
                    args = {"_raw": args}
                actions.append({"name": call.function.name, "arguments": args, "id": call.id, "native": True})
            return actions, thought, None

        # 2) JSON protocol dalam content
        payload = self._extract_json(thought)
        if payload:
            reasoning = str(payload.get("thought") or payload.get("reasoning") or "").strip()
            if reasoning:
                thought = reasoning

            if payload.get("final_answer"):
                return [], thought, str(payload["final_answer"])

            action_name = payload.get("action") or payload.get("tool") or payload.get("name")
            if action_name:
                args = (
                    payload.get("action_input")
                    or payload.get("arguments")
                    or payload.get("input")
                    or payload.get("parameters")
                    or {}
                )
                if isinstance(args, str):
                    if action_name == "execute_in_sandbox":
                        args = {"command": args}
                    elif action_name == "google_search":
                        args = {"query": args}
                    else:
                        args = {"path": args}
                if action_name == ActionType.FINAL_ANSWER.value:
                    return [], thought, str(args.get("answer") or thought)
                if isinstance(args, dict):
                    return [{"name": action_name, "arguments": args, "native": False}], thought, None

        return [], thought, None

    @staticmethod
    def _extract_json(text: str) -> Optional[Dict[str, Any]]:
        """Ambil objek JSON pertama dari teks (menerima blok ```json)."""
        if not text:
            return None

        fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        candidates = list(fenced)

        # Objek JSON balanced pertama
        start = text.find("{")
        while start != -1:
            depth, in_str, esc = 0, False, False
            for i in range(start, len(text)):
                ch = text[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidates.append(text[start : i + 1])
                        break
            break

        for candidate in candidates:
            try:
                data = json.loads(candidate)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue
        return None

    # ──────────────────────────────────────────────────────────────
    # History helpers
    # ──────────────────────────────────────────────────────────────
    def _append_call(self, history: List[Dict[str, Any]], response, action: Dict[str, Any], call_id: str):
        if action.get("native"):
            history.append(
                {
                    "role": "assistant",
                    "content": response.content or "",
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": action["name"],
                                "arguments": json.dumps(action["arguments"], ensure_ascii=False),
                            },
                        }
                    ],
                }
            )
        else:
            history.append({"role": "assistant", "content": response.content or ""})

    def _append_observation(self, history: List[Dict[str, Any]], observation: str, call_id: str):
        last = history[-1] if history else {}
        if last.get("tool_calls"):
            history.append({"role": "tool", "tool_call_id": call_id, "content": observation})
        else:
            history.append({"role": "user", "content": f"OBSERVATION:\n{observation}"})

    @staticmethod
    def _format_observation(result: ToolResult) -> str:
        if result.success:
            text = result.output or "(tidak ada output)"
        else:
            text = f"ERROR (exit_code={result.exit_code}): {result.error or result.output}"
        return text[:MAX_OBSERVATION_CHARS]

    # ──────────────────────────────────────────────────────────────
    # Tools
    # ──────────────────────────────────────────────────────────────
    async def _execute_tool(self, tool_name: str, tool_input: Dict[str, Any], session_id: str) -> ToolResult:
        try:
            if tool_name == "google_search":
                query = str(tool_input.get("query", "")).strip()
                if not query:
                    return ToolResult(False, "", "Parameter 'query' kosong")
                return ToolResult(True, await self.search.search(query))

            if tool_name == "execute_in_sandbox":
                command = str(tool_input.get("command", "")).strip()
                if not command:
                    return ToolResult(False, "", "Parameter 'command' kosong")
                res = await self.sandbox.execute_command(command, session_id=session_id)
                return ToolResult(
                    success=res["exit_code"] == 0,
                    output=res["stdout"],
                    error=res["stderr"] or (res["stdout"] if res["exit_code"] != 0 else None),
                    exit_code=res["exit_code"],
                )

            if tool_name == "write_file_in_sandbox":
                path = str(tool_input.get("path", "")).strip()
                content = tool_input.get("content", "")
                if not path:
                    return ToolResult(False, "", "Parameter 'path' kosong")
                res = await self.sandbox.write_file(path, str(content), session_id=session_id)
                ok = res["exit_code"] == 0
                return ToolResult(
                    success=ok,
                    output=f"File tersimpan: {path}" if ok else res["stdout"],
                    error=None if ok else (res["stderr"] or res["stdout"]),
                    exit_code=res["exit_code"],
                )

            if tool_name == "read_file_in_sandbox":
                path = str(tool_input.get("path", "")).strip()
                res = await self.sandbox.read_file(path, session_id=session_id)
                ok = res["exit_code"] == 0
                return ToolResult(
                    success=ok,
                    output=res["stdout"],
                    error=None if ok else (res["stderr"] or res["stdout"]),
                    exit_code=res["exit_code"],
                )

            if tool_name == "list_files_in_sandbox":
                path = str(tool_input.get("path", "/workspace")).strip() or "/workspace"
                res = await self.sandbox.list_files(path, session_id=session_id)
                ok = res["exit_code"] == 0
                return ToolResult(
                    success=ok,
                    output=res["stdout"],
                    error=None if ok else (res["stderr"] or res["stdout"]),
                    exit_code=res["exit_code"],
                )

            return ToolResult(False, "", f"Tool tidak dikenal: {tool_name}")

        except Exception as exc:  # noqa: BLE001
            logger.exception("Tool execution error: %s", exc)
            return ToolResult(False, "", f"Tool gagal dijalankan: {exc}")

    # ──────────────────────────────────────────────────────────────
    # Prompt & util
    # ──────────────────────────────────────────────────────────────
    def _system_prompt(self) -> str:
        return """You are Dolphin, an autonomous AI agent running on a Linux (Ubuntu) Docker sandbox with full root access.

You solve tasks by: reason -> act (call a tool) -> observe the result -> repeat, until the task is done.

AVAILABLE TOOLS
- google_search(query)                 : cari informasi di web
- execute_in_sandbox(command)          : jalankan perintah bash sebagai root di Ubuntu sandbox
- write_file_in_sandbox(path, content) : buat/timpa file
- read_file_in_sandbox(path)           : baca file
- list_files_in_sandbox(path)          : lihat isi direktori

OUTPUT FORMAT (WAJIB)
Balas HANYA dengan satu objek JSON, tanpa teks lain di luar JSON.

Untuk memanggil tool:
{"thought": "alasan singkat", "action": "execute_in_sandbox", "action_input": {"command": "ls -la /workspace"}}

Kalau tugas sudah selesai:
{"thought": "ringkasan", "final_answer": "jawaban lengkap untuk user"}

ATURAN
- Satu tool per balasan. Tunggu OBSERVATION sebelum langkah berikutnya.
- Perintah non-interaktif: pakai `-y`, set DEBIAN_FRONTEND=noninteractive, hindari perintah yang menunggu input.
- Jangan jalankan proses foreground yang tidak berhenti; pakai `&` + log, atau `timeout`.
- Kalau perintah gagal, baca error-nya, cari solusi via google_search, lalu coba pendekatan lain.
- Direktori kerja default: /workspace.
- Jawaban akhir ditulis dalam bahasa yang sama dengan permintaan user.
"""

    @staticmethod
    def _status(state: str, message: str) -> Dict[str, Any]:
        return {"type": "status", "state": state, "message": message}

    @staticmethod
    def _tool_emoji(name: str) -> str:
        return {
            "google_search": "🔍",
            "execute_in_sandbox": "💻",
            "write_file_in_sandbox": "📝",
            "read_file_in_sandbox": "📖",
            "list_files_in_sandbox": "📂",
        }.get(name, "⚙️")

    @staticmethod
    def _describe(name: str, args: Dict[str, Any]) -> str:
        if name == "google_search":
            return f'Mencari: "{args.get("query", "")}"'
        if name == "execute_in_sandbox":
            return f'$ {str(args.get("command", ""))[:160]}'
        if name == "write_file_in_sandbox":
            return f'Menulis file: {args.get("path", "")}'
        if name == "read_file_in_sandbox":
            return f'Membaca file: {args.get("path", "")}'
        if name == "list_files_in_sandbox":
            return f'Melihat direktori: {args.get("path", "/workspace")}'
        return name

    # ──────────────────────────────────────────────────────────────
    def get_session(self, session_id: str) -> Optional[AgentSession]:
        return self.sessions.get(session_id)

    def cancel(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if session:
            session.cancelled = True
            return True
        return False

    def cleanup_session(self, session_id: str):
        self.sessions.pop(session_id, None)
