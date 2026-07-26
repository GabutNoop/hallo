"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion } from "framer-motion";
import LiveTerminalLog from "@/components/LiveTerminalLog";
import ChatPanel from "@/components/ChatPanel";

// ──────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

// ──────────────────────────────────────────────────────────────────────
// Main Page Component
// ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [sessionId, setSessionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string>("Initializing...");
  const socketRef = useRef<Socket | null>(null);
  const [terminalKey, setTerminalKey] = useState(0);

  // Initialize session
  useEffect(() => {
    const initSession = async () => {
      try {
        // Create new session via REST API
        const response = await fetch(`${BACKEND_URL}/sessions`, {
          method: "POST",
        });
        const data = await response.json();
        setSessionId(data.session_id);
        setStatus("Ready");
        
        // Force terminal re-mount with new session
        setTerminalKey((prev) => prev + 1);
      } catch (error) {
        console.error("Failed to create session:", error);
        setStatus("Error connecting to backend");
      }
    };

    initSession();
  }, []);

  // Handle sending task
  const handleSendTask = useCallback(
    (task: string) => {
      if (!sessionId) {
        console.error("No active session");
        return;
      }

      setIsLoading(true);

      // Connect WebSocket and send task
      const wsUrl = WS_URL;
      const socket = io(wsUrl, {
        path: `/ws/${sessionId}`,
        transports: ["websocket"],
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        // Send the task
        socket.emit("message", JSON.stringify({
          type: "task",
          task: task,
        }));
      });

      socket.on("message", (data: string) => {
        const parsed = JSON.parse(data);
        
        if (parsed.type === "final_answer") {
          setIsLoading(false);
        } else if (parsed.type === "error") {
          setIsLoading(false);
        }
      });

      socket.on("disconnect", () => {
        setIsLoading(false);
      });

      socket.on("connect_error", () => {
        setIsLoading(false);
      });
    },
    [sessionId]
  );

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              className="text-2xl"
            >
              🤖
            </motion.div>
            <div>
              <h1 className="text-xl font-bold text-white">
                Autonomous AI Agent
              </h1>
              <p className="text-xs text-gray-500">
                Self-Correcting • Docker Sandbox • Real-Time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-500">
              <span className="text-gray-600">Model:</span>{" "}
              <span className="text-blue-400">Gemma4-12B-Uncensored</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  status === "Ready"
                    ? "bg-green-500"
                    : status === "Error connecting to backend"
                    ? "bg-red-500"
                    : "bg-yellow-500 animate-pulse"
                }`}
              />
              <span className="text-xs text-gray-400">{status}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Split Screen */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="w-1/2 p-4 border-r border-gray-800">
          <ChatPanel
            sessionId={sessionId}
            onSendTask={handleSendTask}
            isLoading={isLoading}
          />
        </div>

        {/* Right Panel - Live Terminal */}
        <div className="w-1/2 p-4">
          <LiveTerminalLog
            key={terminalKey}
            sessionId={sessionId}
            backendUrl={WS_URL}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 px-6 py-2 bg-gray-900 border-t border-gray-800">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>
            Powered by HauhauCS/Gemma4-12B-QAT-Uncensored
          </span>
          <span>
            {sessionId && `Session: ${sessionId.slice(0, 12)}...`}
          </span>
        </div>
      </footer>
    </div>
  );
}
