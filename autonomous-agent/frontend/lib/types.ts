export type AgentEventType =
  | "session_ready"
  | "status"
  | "thought"
  | "tool_execution"
  | "final_answer"
  | "error"
  | "pong";

export interface AgentEvent {
  type: AgentEventType;
  state?: string;
  message?: string;
  step?: number;
  tool?: string;
  input?: Record<string, any>;
  output?: string;
  success?: boolean;
  exit_code?: number;
  is_retry?: boolean;
  retry_count?: number;
  content?: string;
  answer?: string;
  total_steps?: number;
  retries?: number;
  model?: string;
  sandbox?: boolean;
  session_id?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  pending?: boolean;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface HealthResponse {
  status: string;
  llm: {
    healthy: boolean;
    server_alive: boolean;
    model: string;
    available_models: string[];
    base_url: string;
  };
  docker: { healthy: boolean; image: string };
  active_sandboxes: number;
  active_sessions: number;
}
