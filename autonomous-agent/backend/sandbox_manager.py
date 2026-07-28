"""
Sandbox Manager - Docker SDK Wrapper

Mengelola container Docker terisolasi (Ubuntu) untuk eksekusi perintah agent.
Perbaikan penting:
- Docker client dibuat lazily + pesan error jelas kalau /var/run/docker.sock tidak ada
- stdout & stderr dipisah (demux=True)
- Nama container unik & bersihkan sisa container lama
- write_file lewat tar archive (aman untuk konten apa pun, termasuk quote/heredoc)
- Semua operasi blocking dijalankan di thread executor
"""

import asyncio
import io
import logging
import os
import tarfile
import time
import uuid
from typing import Any, Dict, Optional

import docker
from docker.errors import APIError, DockerException, ImageNotFound, NotFound
from docker.models.containers import Container

logger = logging.getLogger(__name__)


class SandboxError(RuntimeError):
    """Error khusus sandbox."""


class SandboxManager:
    DEFAULT_IMAGE = "ubuntu:22.04"
    DEFAULT_MEMORY_LIMIT = "2g"
    DEFAULT_CPU_LIMIT = 2.0
    DEFAULT_TIMEOUT = 60
    NAME_PREFIX = "agent-sandbox-"

    def __init__(
        self,
        image: Optional[str] = None,
        memory_limit: Optional[str] = None,
        cpu_limit: Optional[float] = None,
        command_timeout: Optional[int] = None,
        network_enabled: bool = True,
        auto_provision: bool = True,
    ):
        self.image = image or self.DEFAULT_IMAGE
        self.memory_limit = memory_limit or self.DEFAULT_MEMORY_LIMIT
        self.cpu_limit = cpu_limit or self.DEFAULT_CPU_LIMIT
        self.command_timeout = command_timeout or self.DEFAULT_TIMEOUT
        self.network_enabled = network_enabled
        self.auto_provision = auto_provision

        self._client: Optional[docker.DockerClient] = None
        self.containers: Dict[str, Container] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

        logger.info("SandboxManager init: image=%s", self.image)

    # ──────────────────────────────────────────────────────────────
    # Docker client
    # ──────────────────────────────────────────────────────────────
    @property
    def client(self) -> docker.DockerClient:
        if self._client is None:
            try:
                self._client = docker.from_env()
                self._client.ping()
            except DockerException as exc:
                raise SandboxError(
                    "Tidak bisa terhubung ke Docker daemon. Pastikan Docker berjalan dan "
                    "socket ter-mount: -v /var/run/docker.sock:/var/run/docker.sock. "
                    f"Detail: {exc}"
                ) from exc
        return self._client

    def docker_available(self) -> bool:
        try:
            self.client.ping()
            return True
        except Exception:  # noqa: BLE001
            return False

    async def _run(self, func, *args, **kwargs):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: func(*args, **kwargs))

    # ──────────────────────────────────────────────────────────────
    # Lifecycle
    # ──────────────────────────────────────────────────────────────
    async def create_sandbox(self, session_id: Optional[str] = None) -> str:
        session_id = session_id or str(uuid.uuid4())

        if session_id in self.containers:
            try:
                container = self.containers[session_id]
                await self._run(container.reload)
                if container.status == "running":
                    return session_id
            except Exception:  # noqa: BLE001
                self.containers.pop(session_id, None)

        name = f"{self.NAME_PREFIX}{session_id[:20]}-{int(time.time())}"

        try:
            await self._ensure_image()

            config: Dict[str, Any] = {
                "image": self.image,
                "name": name,
                "command": ["sleep", "infinity"],
                "detach": True,
                "user": "root",
                "working_dir": "/workspace",
                "mem_limit": self.memory_limit,
                "nano_cpus": int(self.cpu_limit * 1e9),
                "stdin_open": True,
                "tty": False,
                "labels": {"app": "autonomous-agent", "session": session_id},
                "environment": {
                    "DEBIAN_FRONTEND": "noninteractive",
                    "LANG": "C.UTF-8",
                    "PYTHONUNBUFFERED": "1",
                    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                },
                "auto_remove": False,
            }
            if not self.network_enabled:
                config["network_disabled"] = True

            await self._remove_stale(name)

            container = await self._run(self.client.containers.create, **config)
            await self._run(container.start)
            self.containers[session_id] = container
            self._locks[session_id] = asyncio.Lock()

            logger.info("Sandbox dibuat: session=%s container=%s", session_id, container.id[:12])

            await self.execute_command("mkdir -p /workspace", session_id, timeout=30)

            if self.auto_provision:
                asyncio.create_task(self._provision(session_id))

            return session_id

        except SandboxError:
            raise
        except (ImageNotFound, APIError, DockerException) as exc:
            logger.error("Gagal membuat sandbox: %s", exc)
            await self.destroy_sandbox(session_id)
            raise SandboxError(f"Pembuatan sandbox gagal: {exc}") from exc

    async def _ensure_image(self):
        try:
            await self._run(self.client.images.get, self.image)
        except ImageNotFound:
            logger.info("Pulling image %s ...", self.image)
            await self._run(self.client.images.pull, self.image)
            logger.info("Image %s siap", self.image)

    async def _remove_stale(self, name: str):
        try:
            old = await self._run(self.client.containers.get, name)
            await self._run(old.remove, force=True)
        except NotFound:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.debug("Stale container check: %s", exc)

    async def _provision(self, session_id: str):
        """Install tooling dasar di background supaya session cepat siap."""
        cmd = (
            "export DEBIAN_FRONTEND=noninteractive && "
            "apt-get update -qq && "
            "apt-get install -y -qq --no-install-recommends "
            "ca-certificates curl wget git python3 python3-pip python3-venv "
            "build-essential jq unzip nano procps iproute2 netcat-openbsd"
        )
        try:
            res = await self.execute_command(cmd, session_id, timeout=600)
            if res["exit_code"] == 0:
                logger.info("Sandbox %s ter-provision", session_id)
            else:
                logger.warning("Provisioning sandbox %s gagal sebagian", session_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Provisioning error: %s", exc)

    # ──────────────────────────────────────────────────────────────
    # Eksekusi
    # ──────────────────────────────────────────────────────────────
    async def execute_command(
        self,
        command: str,
        session_id: Optional[str] = None,
        timeout: Optional[int] = None,
        workdir: Optional[str] = None,
    ) -> Dict[str, Any]:
        timeout = timeout or self.command_timeout

        try:
            session_id = self._resolve_session(session_id)
            container = await self._get_container(session_id)
        except SandboxError as exc:
            return self._result("", str(exc), -1, command)

        lock = self._locks.setdefault(session_id, asyncio.Lock())

        def _exec():
            return container.exec_run(
                cmd=["bash", "-lc", command],
                user="root",
                workdir=workdir or "/workspace",
                demux=True,
                environment={
                    "DEBIAN_FRONTEND": "noninteractive",
                    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                },
            )

        async with lock:
            try:
                exec_result = await asyncio.wait_for(self._run(_exec), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("Command timeout %ss: %s", timeout, command[:120])
                return self._result(
                    "", f"Perintah timeout setelah {timeout} detik. Jalankan di background atau naikkan COMMAND_TIMEOUT.", 124, command
                )
            except Exception as exc:  # noqa: BLE001
                logger.error("Command error: %s", exc)
                return self._result("", f"Execution error: {exc}", -1, command)

        stdout_b, stderr_b = (exec_result.output or (None, None))
        stdout = (stdout_b or b"").decode("utf-8", errors="replace").strip()
        stderr = (stderr_b or b"").decode("utf-8", errors="replace").strip()

        return self._result(stdout, stderr, exec_result.exit_code, command)

    @staticmethod
    def _result(stdout: str, stderr: str, exit_code: int, command: str) -> Dict[str, Any]:
        return {"stdout": stdout, "stderr": stderr, "exit_code": exit_code, "command": command}

    # ──────────────────────────────────────────────────────────────
    # File operations
    # ──────────────────────────────────────────────────────────────
    async def write_file(self, path: str, content: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        """Tulis file lewat tar archive (aman untuk semua karakter)."""
        try:
            session_id = self._resolve_session(session_id)
            container = await self._get_container(session_id)
        except SandboxError as exc:
            return self._result("", str(exc), -1, f"write_file {path}")

        if not path.startswith("/"):
            path = f"/workspace/{path}"

        directory = os.path.dirname(path) or "/"
        filename = os.path.basename(path)

        mk = await self.execute_command(f"mkdir -p {self._quote(directory)}", session_id, timeout=30)
        if mk["exit_code"] != 0:
            return mk

        data = content.encode("utf-8")
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            info = tarfile.TarInfo(name=filename)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
        stream.seek(0)

        try:
            ok = await self._run(container.put_archive, directory, stream.getvalue())
            if not ok:
                return self._result("", "put_archive gagal", 1, f"write_file {path}")
            return self._result(f"File tersimpan: {path} ({len(data)} bytes)", "", 0, f"write_file {path}")
        except Exception as exc:  # noqa: BLE001
            logger.error("write_file error: %s", exc)
            return self._result("", f"Gagal menulis file: {exc}", -1, f"write_file {path}")

    async def read_file(self, path: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        return await self.execute_command(f"cat {self._quote(path)}", session_id)

    async def list_files(self, path: str = "/workspace", session_id: Optional[str] = None) -> Dict[str, Any]:
        return await self.execute_command(f"ls -la {self._quote(path)}", session_id)

    async def install_package(
        self, package: str, package_manager: str = "apt", session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        pm = package_manager.lower()
        if pm == "apt":
            cmd = f"DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y -qq {package}"
        elif pm == "pip":
            cmd = f"pip3 install --break-system-packages {package} || pip3 install {package}"
        elif pm == "npm":
            cmd = f"npm install -g {package}"
        else:
            return self._result("", f"Package manager tidak dikenal: {package_manager}", -1, "")
        return await self.execute_command(cmd, session_id, timeout=600)

    @staticmethod
    def _quote(value: str) -> str:
        return "'" + str(value).replace("'", "'\\''") + "'"

    # ──────────────────────────────────────────────────────────────
    # Info & cleanup
    # ──────────────────────────────────────────────────────────────
    async def get_container_info(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        try:
            session_id = self._resolve_session(session_id)
            container = await self._get_container(session_id)
            stats = await self._run(container.stats, stream=False)
            return {
                "id": container.id[:12],
                "name": container.name,
                "status": container.status,
                "image": self.image,
                "created": container.attrs.get("Created", ""),
                "memory_usage": stats.get("memory_stats", {}).get("usage", 0),
                "memory_limit": stats.get("memory_stats", {}).get("limit", 0),
            }
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    async def destroy_sandbox(self, session_id: str) -> bool:
        container = self.containers.pop(session_id, None)
        self._locks.pop(session_id, None)
        if container is None:
            return False
        try:
            await self._run(container.remove, force=True)
            logger.info("Sandbox dihapus: %s", session_id)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("Gagal menghapus sandbox %s: %s", session_id, exc)
            return False

    async def destroy_all(self):
        for session_id in list(self.containers.keys()):
            await self.destroy_sandbox(session_id)

        # Bersihkan container yatim dari run sebelumnya
        try:
            leftovers = await self._run(
                self.client.containers.list,
                all=True,
                filters={"label": "app=autonomous-agent"},
            )
            for container in leftovers:
                try:
                    await self._run(container.remove, force=True)
                except Exception:  # noqa: BLE001
                    pass
        except Exception:  # noqa: BLE001
            pass

    def list_active_sessions(self) -> list:
        sessions = []
        for session_id, container in self.containers.items():
            try:
                container.reload()
                status = container.status
            except Exception:  # noqa: BLE001
                status = "error"
            sessions.append(
                {
                    "session_id": session_id,
                    "container_id": container.id[:12],
                    "status": status,
                    "image": self.image,
                }
            )
        return sessions

    # ──────────────────────────────────────────────────────────────
    def _resolve_session(self, session_id: Optional[str]) -> str:
        if session_id and session_id in self.containers:
            return session_id
        if session_id:
            raise SandboxError(f"Sandbox tidak ditemukan untuk session: {session_id}")
        if not self.containers:
            raise SandboxError("Tidak ada sandbox aktif")
        return next(iter(self.containers))

    async def _get_container(self, session_id: str) -> Container:
        container = self.containers.get(session_id)
        if container is None:
            raise SandboxError(f"Sandbox tidak ditemukan untuk session: {session_id}")
        try:
            await self._run(container.reload)
        except Exception as exc:  # noqa: BLE001
            raise SandboxError(f"Gagal memeriksa container: {exc}") from exc

        if container.status != "running":
            try:
                await self._run(container.start)
                await self._run(container.reload)
            except Exception as exc:  # noqa: BLE001
                raise SandboxError(f"Container sandbox tidak berjalan ({container.status}): {exc}") from exc
        return container
