"""
Sandbox Manager - Docker SDK Wrapper
Manages isolated Docker containers for AI agent execution
"""

import asyncio
import logging
import uuid
from typing import Dict, Optional, Any, Tuple
import docker
from docker.errors import ContainerError, ImageNotFound, APIError
from docker.models.containers import Container

logger = logging.getLogger(__name__)


class SandboxManager:
    """
    Manages Docker sandbox containers for AI agent execution.
    Each session gets an isolated container with root access.
    """
    
    # Default sandbox configuration
    DEFAULT_IMAGE = "ubuntu:22.04"
    DEFAULT_MEMORY_LIMIT = "2g"
    DEFAULT_CPU_LIMIT = 2.0  # CPU cores
    DEFAULT_TIMEOUT = 60  # seconds per command
    DEFAULT_DISK_LIMIT = "10g"
    
    def __init__(
        self,
        image: str = None,
        memory_limit: str = None,
        cpu_limit: float = None,
        command_timeout: int = None,
        network_enabled: bool = True
    ):
        """
        Initialize Sandbox Manager.
        
        Args:
            image: Docker image to use for sandbox
            memory_limit: Memory limit for container (e.g., "2g")
            cpu_limit: CPU limit (number of cores)
            command_timeout: Timeout for individual commands in seconds
            network_enabled: Whether container has network access
        """
        self.image = image or self.DEFAULT_IMAGE
        self.memory_limit = memory_limit or self.DEFAULT_MEMORY_LIMIT
        self.cpu_limit = cpu_limit or self.DEFAULT_CPU_LIMIT
        self.command_timeout = command_timeout or self.DEFAULT_TIMEOUT
        self.network_enabled = network_enabled
        
        # Docker client
        self.client = docker.from_env()
        
        # Active containers: session_id -> Container
        self.containers: Dict[str, Container] = {}
        
        logger.info(f"SandboxManager initialized with image={self.image}")
    
    async def create_sandbox(self, session_id: str = None) -> str:
        """
        Create a new isolated sandbox container.
        
        Args:
            session_id: Optional session identifier. Generated if not provided.
            
        Returns:
            session_id of the created sandbox
        """
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        try:
            # Pull image if not available locally
            try:
                self.client.images.get(self.image)
            except ImageNotFound:
                logger.info(f"Pulling image {self.image}...")
                self.client.images.pull(self.image)
                logger.info(f"Image {self.image} pulled successfully")
            
            # Container configuration
            container_config = {
                "image": self.image,
                "name": f"agent-sandbox-{session_id}",
                "detach": True,
                "user": "root",
                "working_dir": "/workspace",
                "mem_limit": self.memory_limit,
                "nano_cpus": int(self.cpu_limit * 1e9),
                "stdin_open": True,
                "tty": True,
                "environment": {
                    "DEBIAN_FRONTEND": "noninteractive",
                    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
                },
                # Auto-remove on stop
                "auto_remove": False,
            }
            
            # Network configuration
            if not self.network_enabled:
                container_config["network_disabled"] = True
            
            # Create and start container
            container = self.client.containers.create(**container_config)
            container.start()
            
            # Store reference
            self.containers[session_id] = container
            
            logger.info(f"Sandbox created: session_id={session_id}, container_id={container.id[:12]}")
            
            # Initialize workspace directory
            await self.execute_command("mkdir -p /workspace", session_id)
            
            # Install basic utilities
            init_cmd = (
                "apt-get update -qq && "
                "apt-get install -y -qq "
                "curl wget git python3 python3-pip "
                "nodejs npm build-essential "
                "jq netcat-openbsd "
                "> /dev/null 2>&1 || true"
            )
            await self.execute_command(init_cmd, session_id, timeout=120)
            
            logger.info(f"Sandbox initialized: session_id={session_id}")
            
            return session_id
            
        except (ContainerError, ImageNotFound, APIError) as e:
            logger.error(f"Failed to create sandbox: {e}")
            # Cleanup on failure
            if session_id in self.containers:
                self.destroy_sandbox(session_id)
            raise RuntimeError(f"Sandbox creation failed: {str(e)}")
    
    async def execute_command(
        self,
        command: str,
        session_id: str = None,
        timeout: int = None,
        workdir: str = None
    ) -> Dict[str, Any]:
        """
        Execute a shell command in the sandbox container.
        
        Args:
            command: Shell command to execute
            session_id: Target sandbox session
            timeout: Command timeout in seconds
            workdir: Working directory for the command
            
        Returns:
            Dict with stdout, stderr, exit_code
        """
        timeout = timeout or self.command_timeout
        
        # If no session_id, use the first (or only) container
        if session_id is None:
            if not self.containers:
                raise RuntimeError("No active sandbox session")
            session_id = list(self.containers.keys())[0]
        
        container = self._get_container(session_id)
        
        # Build the full command
        full_command = command
        if workdir:
            full_command = f"cd {workdir} && {command}"
        
        try:
            # Execute command with timeout
            loop = asyncio.get_event_loop()
            
            exec_result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: container.exec_run(
                        cmd=["bash", "-c", full_command],
                        user="root",
                        workdir=workdir,
                        environment={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
                    )
                ),
                timeout=timeout
            )
            
            exit_code = exec_result.exit_code
            output = exec_result.output.decode("utf-8", errors="replace").strip()
            
            # Parse output - split stdout and stderr isn't straightforward with exec_run
            # We'll treat it all as stdout since bash -c redirects
            return {
                "stdout": output,
                "stderr": "",
                "exit_code": exit_code,
                "command": command
            }
            
        except asyncio.TimeoutError:
            logger.warning(f"Command timed out after {timeout}s: {command[:100]}")
            return {
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "exit_code": -1,
                "command": command
            }
        except Exception as e:
            logger.error(f"Command execution error: {e}")
            return {
                "stdout": "",
                "stderr": f"Execution error: {str(e)}",
                "exit_code": -1,
                "command": command
            }
    
    async def write_file(
        self,
        path: str,
        content: str,
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        Write content to a file in the sandbox.
        
        Args:
            path: Absolute path in the container
            content: File content to write
            session_id: Target sandbox session
            
        Returns:
            Execution result dict
        """
        # Use heredoc approach for writing files safely
        # Escape content for shell safety
        escaped_content = content.replace("'", "'\\''")
        command = f"cat > {path} << 'AGENT_EOF_MARKER'\n{content}\nAGENT_EOF_MARKER"
        
        return await self.execute_command(command, session_id)
    
    async def read_file(
        self,
        path: str,
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        Read a file from the sandbox.
        
        Args:
            path: Absolute path in the container
            session_id: Target sandbox session
            
        Returns:
            Execution result dict with file content in stdout
        """
        return await self.execute_command(f"cat {path}", session_id)
    
    async def list_files(
        self,
        path: str = "/workspace",
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        List files in a directory within the sandbox.
        
        Args:
            path: Directory path to list
            session_id: Target sandbox session
            
        Returns:
            Execution result dict
        """
        return await self.execute_command(f"ls -la {path}", session_id)
    
    async def install_package(
        self,
        package: str,
        package_manager: str = "apt",
        session_id: str = None
    ) -> Dict[str, Any]:
        """
        Install a package in the sandbox.
        
        Args:
            package: Package name to install
            package_manager: Package manager to use (apt, pip, npm)
            session_id: Target sandbox session
            
        Returns:
            Execution result dict
        """
        if package_manager == "apt":
            cmd = f"apt-get update -qq && apt-get install -y -qq {package}"
        elif package_manager == "pip":
            cmd = f"pip3 install {package}"
        elif package_manager == "npm":
            cmd = f"npm install -g {package}"
        else:
            return {
                "stdout": "",
                "stderr": f"Unknown package manager: {package_manager}",
                "exit_code": -1,
                "command": ""
            }
        
        return await self.execute_command(cmd, session_id, timeout=120)
    
    async def get_container_info(self, session_id: str = None) -> Dict[str, Any]:
        """
        Get information about the sandbox container.
        
        Args:
            session_id: Target sandbox session
            
        Returns:
            Container information dict
        """
        container = self._get_container(session_id)
        
        try:
            container_info = container.attrs
            stats = container.stats(stream=False)
            
            return {
                "id": container.id[:12],
                "name": container.name,
                "status": container.status,
                "image": container.image.tags[0] if container.image.tags else container.short_id,
                "created": container_info.get("Created", ""),
                "cpu_usage": stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0),
                "memory_usage": stats.get("memory_stats", {}).get("usage", 0),
                "memory_limit": stats.get("memory_stats", {}).get("limit", 0),
            }
        except Exception as e:
            logger.error(f"Error getting container info: {e}")
            return {"error": str(e)}
    
    async def destroy_sandbox(self, session_id: str) -> bool:
        """
        Destroy a sandbox container and clean up resources.
        
        Args:
            session_id: Sandbox session to destroy
            
        Returns:
            True if successfully destroyed
        """
        if session_id not in self.containers:
            logger.warning(f"No sandbox found for session: {session_id}")
            return False
        
        container = self.containers[session_id]
        
        try:
            logger.info(f"Destroying sandbox: session_id={session_id}, container_id={container.id[:12]}")
            
            # Stop container with grace period
            container.stop(timeout=5)
            
            # Remove container
            container.remove(force=True)
            
            # Remove from tracking
            del self.containers[session_id]
            
            logger.info(f"Sandbox destroyed: session_id={session_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error destroying sandbox: {e}")
            # Force remove if normal removal fails
            try:
                container.remove(force=True)
                if session_id in self.containers:
                    del self.containers[session_id]
            except Exception:
                pass
            return False
    
    async def destroy_all(self):
        """Destroy all active sandbox containers."""
        session_ids = list(self.containers.keys())
        for session_id in session_ids:
            await self.destroy_sandbox(session_id)
    
    def _get_container(self, session_id: str = None) -> Container:
        """Get container for a session, raising error if not found."""
        if session_id is None:
            if not self.containers:
                raise RuntimeError("No active sandbox sessions")
            session_id = list(self.containers.keys())[0]
        
        if session_id not in self.containers:
            raise RuntimeError(f"Sandbox not found for session: {session_id}")
        
        container = self.containers[session_id]
        
        # Verify container is still running
        try:
            container.reload()
            if container.status != "running":
                raise RuntimeError(f"Sandbox container is not running (status: {container.status})")
        except Exception as e:
            raise RuntimeError(f"Sandbox container check failed: {str(e)}")
        
        return container
    
    def list_active_sessions(self) -> list:
        """List all active sandbox sessions."""
        sessions = []
        for session_id, container in self.containers.items():
            try:
                container.reload()
                sessions.append({
                    "session_id": session_id,
                    "container_id": container.id[:12],
                    "status": container.status,
                    "image": self.image
                })
            except Exception:
                sessions.append({
                    "session_id": session_id,
                    "status": "error",
                    "image": self.image
                })
        return sessions
    
    def __del__(self):
        """Cleanup on garbage collection."""
        # Note: This is not reliable for cleanup
        # Use destroy_all() explicitly
        pass
