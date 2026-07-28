"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, ConnectionStatus } from "./types";

interface Options {
  wsUrl: string;
  sessionId: string;
  onEvent: (event: AgentEvent) => void;
}

/**
 * Satu koneksi WebSocket native (bukan socket.io) ke backend FastAPI:
 *   ws://host:8000/ws/{session_id}
 * Dilengkapi auto-reconnect dengan backoff dan heartbeat ping.
 */
export function useAgentSocket({ wsUrl, sessionId, onEvent }: Options) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  const eventRef = useRef(onEvent);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  eventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!sessionId) return;
    if (typeof window === "undefined") return;

    closedRef.current = false;
    setStatus("connecting");

    const base = wsUrl.replace(/^http/, "ws").replace(/\/$/, "");
    const socket = new WebSocket(`${base}/ws/${sessionId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      retryRef.current = 0;
      setStatus("connected");
      if (pingRef.current) clearInterval(pingRef.current);
      pingRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      try {
        const data: AgentEvent = JSON.parse(event.data);
        if (data.type === "pong") return;
        eventRef.current(data);
      } catch {
        // abaikan pesan yang bukan JSON
      }
    };

    socket.onerror = () => setStatus("error");

    socket.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (closedRef.current) return;
      setStatus("disconnected");
      const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
      retryRef.current += 1;
      reconnectRef.current = setTimeout(connect, delay);
    };
  }, [sessionId, wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      closedRef.current = true;
      if (pingRef.current) clearInterval(pingRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  return { status, send };
}
