"""
Autonomous AI Agent - Self-Correcting ReAct Loop
Mengimplementasikan pola Reason-Act-Observe dengan self-correction
"""

import json
import logging
from typing import AsyncIterator, Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum
import asyncio

from llm_client import LLMClient
from sandbox_manager import SandboxManager
from search_tool import SearchTool

logger = logging.getLogger(__name__)


class ActionType(Enum):
    """Jenis action yang bisa dilakukan agent"""
    GOOGLE_SEARCH = "google_search"
    EXECUTE_IN_SANDBOX = "execute_in_sandbox"
    WRITE_FILE_IN_SANDBOX = "write_file_in_sandbox"
    READ_FILE_IN_SANDBOX = "read_file_in_sandbox"
    FINAL_ANSWER = "final_answer"


class AgentState(Enum):
    """State agent saat ini"""
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
    """Hasil eksekusi tool"""
    success: bool
    output: str
    error: Optional[str] = None
    exit_code: Optional[int] = None


@dataclass
class AgentStep:
    """Representasi satu langkah dalam agentic loop"""
    step_number: int
    action_type: ActionType
    thought: str
    tool_input: Dict[str, Any]
    tool_output: Optional[ToolResult] = None
    is_retry: bool = False
    retry_count: int = 0


@dataclass
class AgentSession:
    """Session agent yang sedang berjalan"""
    session_id: str
    task: str
    state: AgentState = AgentState.IDLE
    steps: List[AgentStep] = field(default_factory=list)
    final_answer: Optional[str] = None
    error: Optional[str] = None


class AgentLoop:
    """
    Self-Correcting Agentic Loop dengan kemampuan:
    - Reasoning sebelum action
    - Web search untuk informasi terkini
    - Sandbox execution dengan error handling
    - Self-correction hingga 5x retry
    """
    
    def __init__(
        self,
        llm_client: LLMClient,
        sandbox_manager: SandboxManager,
        search_tool: SearchTool,
        max_retries: int = 5
    ):
        self.llm = llm_client
        self.sandbox = sandbox_manager
        self.search = search_tool
        self.max_retries = max_retries
        self.sessions: Dict[str, AgentSession] = {}
        
        # Define available tools untuk function calling
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": "google_search",
                    "description": "Search the web for information using DuckDuckGo. Use this to find installation guides, API documentation, error solutions, or any current information needed to complete the task.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query to find relevant information"
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_in_sandbox",
                    "description": "Execute a shell command in the isolated Docker sandbox with root access. Use this to install packages, run scripts, compile code, or test functionality.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {
                                "type": "string",
                                "description": "Shell command to execute (will run as root)"
                            }
                        },
                        "required": ["command"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "write_file_in_sandbox",
                    "description": "Create or write content to a file in the sandbox. Use this to create configuration files, source code, or any files needed for the task.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Absolute path where to write the file"
                            },
                            "content": {
                                "type": "string",
                                "description": "Content to write to the file"
                            }
                        },
                        "required": ["path", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file_in_sandbox",
                    "description": "Read the content of a file from the sandbox. Use this to inspect files, check configurations, or debug issues.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Absolute path of the file to read"
                            }
                        },
                        "required": ["path"]
                    }
                }
            }
        ]
    
    async def execute_task(
        self,
        session_id: str,
        task: str
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Execute a task with self-correcting agentic loop.
        Yields progress updates and final answer.
        """
        # Initialize session
        session = AgentSession(session_id=session_id, task=task)
        self.sessions[session_id] = session
        
        try:
            # Step 1: Initial reasoning
            yield {
                "type": "status",
                "state": "reasoning",
                "message": "🧠 Analyzing task and planning approach..."
            }
            
            session.state = AgentState.REASONING
            current_retry = 0
            conversation_history = []
            
            # Add initial system prompt
            system_prompt = self._build_system_prompt(task)
            conversation_history.append({"role": "system", "content": system_prompt})
            
            # Main agentic loop
            while current_retry <= self.max_retries:
                step_number = len(session.steps) + 1
                
                # Get LLM decision
                yield {
                    "type": "status",
                    "state": "reasoning",
                    "message": f"🧠 Step {step_number}: AI is thinking..."
                }
                
                response = await self.llm.chat_completion(
                    messages=conversation_history,
                    tools=self.tools,
                    temperature=0.3 if current_retry > 0 else 0.7
                )
                
                # Check if LLM wants to use a tool
                if response.tool_calls:
                    for tool_call in response.tool_calls:
                        # Execute the tool
                        tool_result = await self._execute_tool(
                            tool_call.function.name,
                            json.loads(tool_call.function.arguments),
                            session_id=session_id
                        )
                        
                        # Create step record
                        step = AgentStep(
                            step_number=step_number,
                            action_type=ActionType(tool_call.function.name),
                            thought=response.content or "",
                            tool_input=json.loads(tool_call.function.arguments),
                            tool_output=tool_result,
                            is_retry=current_retry > 0,
                            retry_count=current_retry
                        )
                        session.steps.append(step)
                        
                        # Yield tool execution result
                        yield {
                            "type": "tool_execution",
                            "step": step_number,
                            "tool": tool_call.function.name,
                            "input": step.tool_input,
                            "output": tool_result.output if tool_result.success else tool_result.error,
                            "success": tool_result.success,
                            "exit_code": tool_result.exit_code,
                            "is_retry": current_retry > 0,
                            "retry_count": current_retry
                        }
                        
                        # Add to conversation history
                        conversation_history.append({
                            "role": "assistant",
                            "content": response.content,
                            "tool_calls": [tool_call.model_dump()]
                        })
                        
                        conversation_history.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result.output if tool_result.success else f"ERROR: {tool_result.error}"
                        })
                        
                        # Check if execution failed and needs retry
                        if not tool_result.success and tool_call.function.name == "execute_in_sandbox":
                            if current_retry < self.max_retries:
                                current_retry += 1
                                yield {
                                    "type": "status",
                                    "state": "correcting",
                                    "message": f"❌ Error detected. Self-correcting (attempt {current_retry}/{self.max_retries})..."
                                }
                                
                                # Search for error solution
                                error_msg = tool_result.error or "Unknown error"
                                search_query = f"how to fix error: {error_msg[:200]}"
                                
                                yield {
                                    "type": "status",
                                    "state": "searching",
                                    "message": f"🔍 Searching for solution: {search_query[:100]}..."
                                }
                                
                                search_result = await self.search.search(search_query)
                                
                                yield {
                                    "type": "tool_execution",
                                    "step": step_number,
                                    "tool": "google_search",
                                    "input": {"query": search_query},
                                    "output": search_result,
                                    "success": True,
                                    "is_retry": True,
                                    "retry_count": current_retry
                                }
                                
                                # Add search results to conversation
                                conversation_history.append({
                                    "role": "user",
                                    "content": f"The previous command failed with this error:\n\n{error_msg}\n\nHere are some search results that might help fix it:\n\n{search_result}\n\nPlease analyze the error and try a different approach."
                                })
                            else:
                                # Max retries reached
                                session.state = AgentState.FAILED
                                session.error = f"Failed after {self.max_retries} attempts"
                                yield {
                                    "type": "error",
                                    "message": f"❌ Task failed after {self.max_retries} retry attempts",
                                    "error": tool_result.error
                                }
                                return
                        
                        # Yield small delay for streaming effect
                        await asyncio.sleep(0.1)
                
                else:
                    # LLM provided final answer without tool calls
                    session.state = AgentState.COMPLETED
                    session.final_answer = response.content
                    
                    yield {
                        "type": "final_answer",
                        "answer": response.content,
                        "total_steps": len(session.steps),
                        "retries": current_retry
                    }
                    
                    return
            
            # If we exit loop without returning, task failed
            session.state = AgentState.FAILED
            session.error = "Max iterations reached"
            yield {
                "type": "error",
                "message": "❌ Task could not be completed within the allowed iterations"
            }
            
        except Exception as e:
            logger.exception(f"Agent loop error: {e}")
            session.state = AgentState.FAILED
            session.error = str(e)
            yield {
                "type": "error",
                "message": f"❌ Agent error: {str(e)}"
            }
    
    async def _execute_tool(self, tool_name: str, tool_input: Dict[str, Any], session_id: str = None) -> ToolResult:
        """Execute a tool and return result"""
        try:
            if tool_name == "google_search":
                result = await self.search.search(tool_input["query"])
                return ToolResult(success=True, output=result)
            
            elif tool_name == "execute_in_sandbox":
                result = await self.sandbox.execute_command(
                    tool_input["command"],
                    session_id=session_id
                )
                return ToolResult(
                    success=result["exit_code"] == 0,
                    output=result["stdout"],
                    error=result["stderr"],
                    exit_code=result["exit_code"]
                )
            
            elif tool_name == "write_file_in_sandbox":
                result = await self.sandbox.write_file(
                    tool_input["path"],
                    tool_input["content"],
                    session_id=session_id
                )
                return ToolResult(
                    success=result["exit_code"] == 0,
                    output="File written successfully",
                    error=result["stderr"] if result["exit_code"] != 0 else None,
                    exit_code=result["exit_code"]
                )
            
            elif tool_name == "read_file_in_sandbox":
                result = await self.sandbox.read_file(
                    tool_input["path"],
                    session_id=session_id
                )
                return ToolResult(
                    success=result["exit_code"] == 0,
                    output=result["stdout"],
                    error=result["stderr"] if result["exit_code"] != 0 else None,
                    exit_code=result["exit_code"]
                )
            
            else:
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Unknown tool: {tool_name}"
                )
        
        except Exception as e:
            logger.exception(f"Tool execution error: {e}")
            return ToolResult(
                success=False,
                output="",
                error=f"Tool execution failed: {str(e)}"
            )
    
    def _build_system_prompt(self, task: str) -> str:
        """Build system prompt for LLM"""
        return f"""You are an autonomous AI agent operating in a Linux Docker sandbox with root access. Your goal is to complete tasks by:

1. **Reasoning** about what needs to be done
2. **Searching** the web when you need current information (installation guides, API docs, error solutions)
3. **Executing** commands in the sandbox
4. **Self-correcting** when errors occur by searching for solutions and retrying

TASK: {task}

INSTRUCTIONS:
- Always search for information BEFORE executing complex commands (e.g., how to install packages, configure services)
- If a command fails, analyze the error and search for solutions before retrying
- Use write_file_in_sandbox to create necessary files (scripts, configs, etc.)
- Use read_file_in_sandbox to inspect files when debugging
- Be methodical: plan → search → execute → verify
- Provide clear explanations of what you're doing

AVAILABLE TOOLS:
- google_search(query): Search the web for information
- execute_in_sandbox(command): Run shell commands (you have root access)
- write_file_in_sandbox(path, content): Create/edit files
- read_file_in_sandbox(path): Read file contents

When you've completed the task or determined it cannot be done, provide your final answer without calling any tools.
"""
    
    def get_session(self, session_id: str) -> Optional[AgentSession]:
        """Get current session state"""
        return self.sessions.get(session_id)
    
    def cleanup_session(self, session_id: str):
        """Remove session from memory"""
        if session_id in self.sessions:
            del self.sessions[session_id]
