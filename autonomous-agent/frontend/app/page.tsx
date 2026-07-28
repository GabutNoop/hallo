"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import ChatPanel from "@/components/ChatPanel";
import LiveTerminalLog, { TerminalLine } from "@/components/LiveTerminalLog";
import { useAgentSocket } from "@/lib/useAgentSocket";
import type { AgentEvent, ChatMessage, HealthResponse } from "@/lib/types";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || BACKEND_URL.replace(/^http/, "ws");
const MODEL_LABEL = process.env.NEXT_PUBLIC_MODEL_NAME || "dolphin-llama3:8b";
const SESSION_KEY = "agent_session_id";

const TOOL_EMOJI: Record<string, string> = {
  google_search: "🔍",
  execute_in_sandbox: "💻",
  write_file_in_sandbox: "📝",
  read_file_in_sandbox: "📖",
  list_files_in_sandbox: "📂",
};

const STATE_EMOJI: Record<string, string> = {
  reasoning: "🧠",
  searching: "🔍",
  executing: "💻",
  observing: "👁️",
  correcting: "🔧",
  completed: "✅",
  failed: "❌",
  starting: "🎯",
  cancelled: "🛑",
};

let lineCounter = 0;
const nextId = () => `${Date.now()}-${lineCounter++}`;

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const initialized = useRef(false);

  const addLine = useCallback(
    (type: TerminalLine["type"], emoji: string, content: string, details?: string) => {
      setLines((prev) => [
        ...prev.slice(-499),
        { id: nextId(), timestamp: new Date(), type, emoji, content, details },
      ]);
    },
    []
  );

  const addMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role, content, timestamp: new Date() },
    ]);
  }, []);

  // ── Buat / pulihkan session ────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      const cached = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
      if (cached) {
        setSessionId(cached);
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/sessions`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSessionId(data.session_id);
        sessionStorage.setItem(SESSION_KEY, data.session_id);
        if (data.sandbox_error) {
          setSessionError(data.sandbox_error);
          addLine("error", "⚠️", `Sandbox tidak tersedia: ${data.sandbox_error}`);
        }
      } catch (err) {
        setSessionError(String(err));
        addLine("error", "❌", `Gagal membuat session: ${err}`);
      }
    };

    init();
  }, [addLine]);

  // ── Poll health ────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/health`);
        const data = (await res.json()) as HealthResponse;
        if (active) setHealth(data);
      } catch {
        if (active) setHealth(null);
      }
    };
    poll();
    const timer = setInterval(poll, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // ── Handler event dari WebSocket ───────────────────────────────
  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "session_ready":
          addLine("system", event.sandbox ? "🟢" : "⚠️", event.message || "Session siap");
          break;

        case "status": {
          const emoji = STATE_EMOJI[event.state || ""] || "⚡";
          addLine("status", emoji, event.message || event.state || "");
          if (event.state === "cancelled" || event.state === "failed") setIsLoading(false);
          break;
        }

        case "thought":
          if (event.content) {
            addLine("thought", "💭", `Step ${event.step}: ${event.content.slice(0, 400)}`);
          }
          break;

        case "tool_execution": {
          const emoji = TOOL_EMOJI[event.tool || ""] || "⚙️";
          const input = event.input || {};
          let label = "";
          if (event.tool === "google_search") label = `Query: "${input.query}"`;
          else if (event.tool === "execute_in_sandbox") label = `$ ${input.command}`;
          else if (event.tool === "write_file_in_sandbox") label = `Tulis: ${input.path}`;
          else if (event.tool === "read_file_in_sandbox") label = `Baca: ${input.path}`;
          else if (event.tool === "list_files_in_sandbox") label = `Listing: ${input.path}`;
          else label = JSON.stringify(input);

          const retryTag = event.is_retry ? ` [RETRY ${event.retry_count}]` : "";
          addLine(
            event.success ? "tool" : "error",
            emoji,
            `${event.tool}${retryTag}: ${label}`,
            typeof event.output === "string" ? event.output : JSON.stringify(event.output, null, 2)
          );
          break;
        }

        case "final_answer":
          addLine("success", "✅", "Task selesai");
          addLine(
            "info",
            "📊",
            `Total langkah: ${event.total_steps ?? 0} • Retry: ${event.retries ?? 0}`
          );
          addMessage("assistant", event.answer || "(kosong)");
          setIsLoading(false);
          break;

        case "error":
          addLine("error", "❌", event.message || "Unknown error", event.error);
          addMessage("system", event.message || "Terjadi error");
          setIsLoading(false);
          break;

        default:
          break;
      }
    },
    [addLine, addMessage]
  );

  const { status, send } = useAgentSocket({
    wsUrl: WS_URL,
    sessionId,
    onEvent: handleEvent,
  });

  const connected = status === "connected";

  const handleSendTask = useCallback(
    (task: string) => {
      addMessage("user", task);
      const ok = send({ type: "task", task });
      if (ok) {
        setIsLoading(true);
      } else {
        addLine("error", "🔌", "WebSocket belum terhubung. Coba lagi sebentar.");
        addMessage("system", "Koneksi ke backend belum siap.");
      }
    },
    [addLine, addMessage, send]
  );

  const handleCancel = useCallback(() => {
    send({ type: "cancel" });
    setIsLoading(false);
  }, [send]);

  const statusLabel =
    status === "connected"
      ? sessionError
        ? "Terhubung (tanpa sandbox)"
        : "Ready"
      : status === "connecting"
      ? "Menghubungkan…"
      : status === "disconnected"
      ? "Terputus — reconnect…"
      : "Error koneksi";

  const dotClass =
    status === "connected"
      ? sessionError
        ? "bg-yellow-500"
        : "bg-green-500"
      : status === "connecting"
      ? "animate-pulse bg-yellow-500"
      : "bg-red-500";

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      <header className="flex-shrink-0 border-b border-gray-800 bg-gray-900 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              className="text-2xl"
            >
              🐬
            </motion.div>
            <div>
              <h1 className="text-xl font-bold text-white">Autonomous AI Agent</h1>
              <p className="text-xs text-gray-500">
                Self-Correcting • Ubuntu Docker Sandbox • Real-Time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-xs text-gray-500 sm:block">
              <span className="text-gray-600">Model:</span>{" "}
              <span className="text-blue-400">{health?.llm.model || MODEL_LABEL}</span>
            </div>
            <div className="hidden items-center gap-3 text-xs md:flex">
              <span className={health?.llm.healthy ? "text-green-400" : "text-red-400"}>
                LLM {health?.llm.healthy ? "OK" : "DOWN"}
              </span>
              <span className={health?.docker.healthy ? "text-green-400" : "text-red-400"}>
                Docker {health?.docker.healthy ? "OK" : "DOWN"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${dotClass}`} />
              <span className="text-xs text-gray-400">{statusLabel}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="h-1/2 border-b border-gray-800 p-4 lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r">
          <ChatPanel
            sessionId={sessionId}
            messages={messages}
            onSendTask={handleSendTask}
            onCancel={handleCancel}
            isLoading={isLoading}
            connected={connected}
          />
        </div>
        <div className="h-1/2 p-4 lg:h-full lg:w-1/2">
          <LiveTerminalLog
            sessionId={sessionId}
            lines={lines}
            connected={connected}
            onClear={() => setLines([])}
            model={health?.llm.model || MODEL_LABEL}
          />
        </div>
      </main>

      <footer className="flex-shrink-0 border-t border-gray-800 bg-gray-900 px-6 py-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Powered by Dolphin 2.9 Llama 3 (dolphin-llama3:8b) via Ollama</span>
          <span>{sessionId && `Session: ${sessionId.slice(0, 12)}…`}</span>
        </div>
      </footer>
    </div>
  );
}
