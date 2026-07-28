"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatMessage } from "@/lib/types";

interface ChatPanelProps {
  sessionId: string;
  messages: ChatMessage[];
  onSendTask: (task: string) => void;
  onCancel: () => void;
  isLoading: boolean;
  connected: boolean;
}

const EXAMPLES = [
  "Buat REST API Express dengan endpoint /users lalu jalankan dan tes dengan curl",
  "Install Python FastAPI di sandbox, buat app hello world, dan tes dengan curl",
  "Cek versi Ubuntu, CPU, dan memori di sandbox",
];

export default function ChatPanel({
  sessionId,
  messages,
  onSendTask,
  onCancel,
  isLoading,
  connected,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const value = input.trim();
    if (!value || isLoading || !connected) return;
    onSendTask(value);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-white">💬 Chat</h2>
          <p className="text-xs text-gray-400">
            {sessionId ? `Session: ${sessionId.slice(0, 8)}…` : "Menyiapkan session…"}
          </p>
        </div>
        {isLoading && (
          <button
            onClick={onCancel}
            className="rounded-md border border-red-800 bg-red-900/40 px-3 py-1 text-xs text-red-300 transition-colors hover:bg-red-900/70"
          >
            Stop
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-gray-500">
            <div className="mb-3 text-4xl">🐬</div>
            <p className="text-center text-sm">
              Beri tugas ke agent, lalu pantau eksekusinya di terminal sebelah.
            </p>
            <div className="mt-5 w-full max-w-sm space-y-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setInput(example)}
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-left text-xs text-gray-400 transition-colors hover:border-blue-800 hover:text-blue-300"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : msg.role === "system"
                    ? "border border-gray-800 bg-gray-950 text-gray-400"
                    : "border border-gray-700 bg-gray-800 text-gray-100"
                }`}
              >
                <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
                <div
                  className={`mt-1 text-[10px] ${
                    msg.role === "user" ? "text-blue-200" : "text-gray-500"
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2">
              <div className="flex items-center gap-2">
                {[0, 0.2, 0.4].map((delay) => (
                  <motion.div
                    key={delay}
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ repeat: Infinity, duration: 1.4, delay }}
                    className="h-2 w-2 rounded-full bg-blue-500"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-gray-700 bg-gray-800 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Tulis tugas untuk agent…" : "Menunggu koneksi ke backend…"}
            disabled={isLoading || !connected}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !connected || !input.trim()}
            className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Kirim
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Enter untuk kirim • Shift+Enter baris baru
        </div>
      </div>
    </div>
  );
}
