"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  sessionId: string;
  onSendTask: (task: string) => void;
  isLoading: boolean;
}

export default function ChatPanel({
  sessionId,
  onSendTask,
  isLoading,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle send message
  const handleSend = () => {
    if (!input.trim() || isLoading) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    onSendTask(input.trim());
    setInput("");
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Add assistant message (called from parent)
  const addAssistantMessage = (content: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Chat Header */}
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🤖 Autonomous AI Agent
            </h2>
            <p className="text-xs text-gray-400">
              Session: {sessionId.slice(0, 8)}...
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLoading && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"
              />
            )}
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-sm text-center">
              Start a conversation with the AI Agent.
              <br />
              Give it a task and watch it work in the terminal!
            </p>
            <div className="mt-4 text-xs text-gray-600 max-w-xs text-center">
              Example: "Set up a Node.js Express server with a REST API endpoint
              that returns a list of users"
            </div>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-100 border border-gray-700"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                <div
                  className={`text-xs mt-1 ${
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

        {/* Loading indicator */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-2 h-2 bg-blue-500 rounded-full"
                />
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.5,
                    delay: 0.2,
                  }}
                  className="w-2 h-2 bg-blue-500 rounded-full"
                />
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.5,
                    delay: 0.4,
                  }}
                  className="w-2 h-2 bg-blue-500 rounded-full"
                />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gray-800 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Describe a task for the AI agent..."
            disabled={isLoading}
            rows={2}
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Press Enter to send • Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
