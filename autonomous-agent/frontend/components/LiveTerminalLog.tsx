"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export interface TerminalLine {
  id: string;
  timestamp: Date;
  type: "status" | "tool" | "output" | "error" | "success" | "info" | "system" | "thought";
  emoji: string;
  content: string;
  details?: string;
}

interface LiveTerminalLogProps {
  sessionId: string;
  lines: TerminalLine[];
  connected: boolean;
  onClear: () => void;
  model: string;
}

const LINE_COLORS: Record<TerminalLine["type"], string> = {
  status: "text-blue-400",
  tool: "text-green-400",
  output: "text-gray-300",
  error: "text-red-400",
  success: "text-emerald-400",
  info: "text-yellow-400",
  system: "text-purple-400",
  thought: "text-sky-300",
};

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function LiveTerminalLog({
  sessionId,
  lines,
  connected,
  onClear,
  model,
}: LiveTerminalLogProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 font-mono">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
          </div>
          <span className="ml-2 text-xs text-gray-500">
            Agent Terminal — {sessionId ? sessionId.slice(0, 8) : "…"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-2 w-2 rounded-full ${
                connected ? "animate-pulse bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-gray-500">{connected ? "LIVE" : "OFFLINE"}</span>
          </div>
          <button
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`rounded px-2 py-0.5 text-xs ${
              autoScroll ? "bg-blue-900 text-blue-300" : "bg-gray-800 text-gray-500"
            }`}
          >
            Auto-scroll
          </button>
          <button
            onClick={onClear}
            className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={terminalRef}
        className="terminal-scroll flex-1 space-y-1 overflow-y-auto p-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
      >
        <AnimatePresence initial={false}>
          {lines.map((line) => (
            <motion.div
              key={line.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="flex gap-2 text-sm leading-relaxed"
            >
              <span className="flex-shrink-0 select-none text-gray-600">
                [{formatTime(line.timestamp)}]
              </span>
              <span className="flex-shrink-0 select-none">{line.emoji}</span>
              <div className="min-w-0 flex-1">
                <span className={`${LINE_COLORS[line.type]} break-words`}>{line.content}</span>
                {line.details && (
                  <details className="mt-1">
                    <summary className="cursor-pointer select-none text-xs text-gray-600 hover:text-gray-400">
                      Lihat output ({line.details.length} char)
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded border border-gray-800 bg-gray-900 p-2 text-xs text-gray-400">
                      {line.details}
                    </pre>
                  </details>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {lines.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-gray-600">
            <span className="mb-2 text-2xl">🖥️</span>
            <span className="text-sm">Menunggu aktivitas agent…</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 bg-gray-900 px-4 py-1.5">
        <span className="text-xs text-gray-600">{lines.length} event</span>
        <span className="text-xs text-gray-700">{model}</span>
      </div>
    </div>
  );
}
