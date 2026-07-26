"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────
interface TerminalLine {
  id: string;
  timestamp: Date;
  type: "status" | "tool" | "output" | "error" | "success" | "info" | "system";
  emoji: string;
  content: string;
  details?: string;
  isStreaming?: boolean;
}

interface LiveTerminalLogProps {
  sessionId: string;
  backendUrl: string;
  onSessionReady?: () => void;
  onTaskComplete?: (answer: string) => void;
}

// ──────────────────────────────────────────────────────────────────────
// Emoji mapping for different action types
// ──────────────────────────────────────────────────────────────────────
const TOOL_EMOJI_MAP: Record<string, string> = {
  google_search: "🔍",
  execute_in_sandbox: "💻",
  write_file_in_sandbox: "📝",
  read_file_in_sandbox: "📖",
};

const STATE_EMOJI_MAP: Record<string, string> = {
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

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────
export default function LiveTerminalLog({
  sessionId,
  backendUrl,
  onSessionReady,
  onTaskComplete,
}: LiveTerminalLogProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Generate unique ID for each line
  const generateId = () =>
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add a new line to the terminal
  const addLine = useCallback(
    (
      type: TerminalLine["type"],
      emoji: string,
      content: string,
      details?: string
    ) => {
      const newLine: TerminalLine = {
        id: generateId(),
        timestamp: new Date(),
        type,
        emoji,
        content,
        details,
      };
      setLines((prev) => [...prev, newLine]);
    },
    []
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // WebSocket connection
  useEffect(() => {
    const wsUrl = backendUrl.replace(/^http/, "ws");

    const socket = io(wsUrl, {
      path: "/ws",
      transports: ["websocket"],
      query: { session_id: sessionId },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      addLine("system", "🔌", "Connected to agent server");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      addLine("error", "🔌", "Disconnected from agent server");
    });

    // Listen for session ready
    socket.on("session_ready", (data: any) => {
      addLine("system", "🟢", data.message || "Session ready");
      onSessionReady?.();
    });

    // Listen for status updates
    socket.on("status_update", (data: any) => {
      const emoji = STATE_EMOJI_MAP[data.state] || "⚡";
      addLine("status", emoji, data.message);
    });

    // Listen for tool executions
    socket.on("tool_execution", (data: any) => {
      const emoji = TOOL_EMOJI_MAP[data.tool] || "⚙️";
      const retryTag = data.is_retry
        ? ` [RETRY ${data.retry_count}]`
        : "";

      // Log tool input
      let inputDisplay = "";
      if (data.tool === "google_search") {
        inputDisplay = `Query: "${data.input.query}"`;
      } else if (data.tool === "execute_in_sandbox") {
        inputDisplay = `$ ${data.input.command}`;
      } else if (data.tool === "write_file_in_sandbox") {
        inputDisplay = `Writing to: ${data.input.path}`;
      } else if (data.tool === "read_file_in_sandbox") {
        inputDisplay = `Reading: ${data.input.path}`;
      }

      addLine(
        data.success ? "tool" : "error",
        emoji,
        `${data.tool}${retryTag}: ${inputDisplay}`,
        typeof data.output === "string"
          ? data.output.substring(0, 2000)
          : JSON.stringify(data.output, null, 2).substring(0, 2000)
      );
    });

    // Listen for final answer
    socket.on("final_answer", (data: any) => {
      addLine("success", "✅", "Task completed successfully!");
      addLine("info", "📊", `Total steps: ${data.total_steps}, Retries: ${data.retries}`);
      onTaskComplete?.(data.answer);
    });

    // Listen for errors
    socket.on("agent_error", (data: any) => {
      addLine("error", "❌", data.message);
      if (data.error) {
        addLine("error", "📋", `Error details: ${data.error}`);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId, backendUrl, addLine, onSessionReady, onTaskComplete]);

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Color for line type
  const getLineColor = (type: TerminalLine["type"]) => {
    const colors: Record<string, string> = {
      status: "text-blue-400",
      tool: "text-green-400",
      output: "text-gray-300",
      error: "text-red-400",
      success: "text-emerald-400",
      info: "text-yellow-400",
      system: "text-purple-400",
    };
    return colors[type] || "text-gray-300";
  };

  // Clear terminal
  const clearTerminal = () => {
    setLines([]);
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg border border-gray-800 overflow-hidden font-mono">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-gray-500 ml-2">
            Agent Terminal — {sessionId.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-gray-500">
              {isConnected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll
                ? "bg-blue-900 text-blue-300"
                : "bg-gray-800 text-gray-500"
            }`}
          >
            Auto-scroll
          </button>
          {/* Clear button */}
          <button
            onClick={clearTerminal}
            className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 space-y-1 scroll-smooth"
        onScroll={(e) => {
          const el = e.currentTarget;
          const isAtBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(isAtBottom);
        }}
      >
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.div
              key={line.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="flex gap-2 text-sm leading-relaxed"
            >
              {/* Timestamp */}
              <span className="text-gray-600 flex-shrink-0 select-none">
                [{formatTime(line.timestamp)}]
              </span>
              {/* Emoji */}
              <span className="flex-shrink-0 select-none">{line.emoji}</span>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <span className={getLineColor(line.type)}>
                  {line.content}
                </span>
                {/* Details / Output (collapsible) */}
                {line.details && (
                  <details className="mt-1">
                    <summary className="text-gray-600 text-xs cursor-pointer hover:text-gray-400 select-none">
                      Show output ({line.details.length} chars)
                    </summary>
                    <pre className="mt-1 p-2 bg-gray-900 rounded text-xs text-gray-400 whitespace-pre-wrap break-all max-h-64 overflow-y-auto border border-gray-800">
                      {line.details}
                    </pre>
                  </details>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator */}
        {lines.length > 0 &&
          lines[lines.length - 1]?.type === "status" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-2 text-sm"
            >
              <span className="text-gray-600">
                [{formatTime(new Date())}]
              </span>
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-gray-500"
              >
                ⏳ Processing...
              </motion.span>
            </motion.div>
          )}

        {/* Empty state */}
        {lines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <span className="text-2xl mb-2">🖥️</span>
            <span className="text-sm">Waiting for agent activity...</span>
          </div>
        )}
      </div>

      {/* Terminal Footer */}
      <div className="px-4 py-1.5 bg-gray-900 border-t border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-600">
          {lines.length} events • {sessionId.slice(0, 8)}
        </span>
        <span className="text-xs text-gray-700">
          Powered by HauhauCS Gemma4-12B
        </span>
      </div>
    </div>
  );
}
