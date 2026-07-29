#!/usr/bin/env python3
"""Policy-bounded concurrent agent runner for Mattermost, Files.com, and Amazon.

The runner uses PortSwigger's official MCP Server. It can execute three program
workers concurrently, but each worker is constrained by a deterministic policy:

* Mattermost active automation: loopback self-hosted instance only.
* Files.com and Amazon: exact configured host, GET/HEAD/OPTIONS only, one
  concurrent request, conservative rate, fixed request budget.
* Every URL must already be listed in known_urls; the agent cannot discover or
  invent paths.
* No report is submitted automatically. Local duplicate fingerprints prevent
  resubmitting the same candidate from this workspace; external duplicates can
  only be determined by the bounty platform.
"""

from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import hashlib
import json
import os
import re
import sqlite3
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

try:
    import httpx2
    import requests
    import yaml
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    from mcp.types import CallToolResult, TextContent
    from rich import box
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
except ImportError as exc:  # pragma: no cover
    print(f"Missing dependency: {exc}", file=sys.stderr)
    print("Install with: python -m pip install -r requirements.txt", file=sys.stderr)
    raise SystemExit(1) from exc


VERSION = "1.0.0"
PROGRAM_IDS = ("mattermost", "files", "amazon")
PLACEHOLDER_MARKERS = ("YOUR_H1_USERNAME", "YOUR-ASSIGNED-SUBDOMAIN")
REMOTE_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
BLOCKED_REMOTE_PATH_WORDS = {
    "checkout",
    "purchase",
    "payment",
    "billing",
    "delete",
    "destroy",
    "support",
    "contact",
    "message",
    "email",
    "sms",
    "invite",
    "upload",
    "logout",
    "password",
    "otp",
    "captcha",
}
BLOCKED_QUERY_KEYS = {
    "password",
    "passwd",
    "token",
    "otp",
    "captcha",
    "credit_card",
    "card",
    "cvv",
}
console = Console()


@dataclass(frozen=True)
class ProgramProfile:
    program_id: str
    display_name: str
    mode: str
    exact_host: str
    scheme: str
    port: int
    required_user_agent: str
    max_rps: float
    hard_max_rps: float
    request_budget: int
    allowed_methods: frozenset[str]
    known_urls: tuple[str, ...]
    test_email: str
    hackerone_username: str


@dataclass(frozen=True)
class RequestSpec:
    name: str
    method: str
    url: str
    expected_observation: str = ""
    body: str = ""


@dataclass
class RequestResult:
    program_id: str
    request_name: str
    url: str
    status: str
    response_sha256: str = ""
    response_preview: str = ""
    policy_message: str = ""
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class ProgramRunResult:
    program_id: str
    status: str
    requests: list[RequestResult] = field(default_factory=list)
    stopped_reason: str = ""


class MultiProgramConfig:
    def __init__(self, path: str):
        self.path = Path(path)
        try:
            value = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise ValueError(f"Cannot load config: {exc}") from exc
        if not isinstance(value, dict):
            raise TypeError("Configuration root must be a mapping")
        self.raw = value
        self.global_config = value.get("global", {})
        self.program_config = value.get("programs", {})
        if not isinstance(self.global_config, dict) or not isinstance(
            self.program_config, dict
        ):
            raise TypeError("global and programs must be mappings")

    def mcp_endpoint(self) -> str:
        endpoint = str(
            self.global_config.get("burp_mcp_endpoint", "http://127.0.0.1:9876/sse")
        )
        parsed = urlparse(endpoint)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("Burp MCP endpoint must use HTTP(S) on loopback only")
        return endpoint

    def mcp_timeout(self) -> int:
        value = self.global_config.get("mcp_timeout_seconds", 15)
        if not isinstance(value, int) or not 1 <= value <= 60:
            raise ValueError("mcp_timeout_seconds must be from 1 to 60")
        return value

    def audit_dir(self) -> Path:
        return Path(str(self.global_config.get("audit_dir", "./multi_evidence")))

    def duplicate_db(self) -> Path:
        return Path(
            str(
                self.global_config.get(
                    "duplicate_db", "./multi_evidence/duplicate_registry.sqlite3"
                )
            )
        )

    def profile(self, program_id: str, *, require_ready: bool) -> ProgramProfile:
        if program_id not in PROGRAM_IDS:
            raise ValueError(f"Unsupported program: {program_id}")
        value = self.program_config.get(program_id)
        if not isinstance(value, dict):
            raise TypeError(f"Missing program configuration: {program_id}")
        if value.get("enabled") is not True:
            raise ValueError(f"Program is disabled: {program_id}")

        mode = str(value.get("mode", ""))
        if program_id == "mattermost":
            if mode != "self_hosted_only":
                raise ValueError("Mattermost autonomous mode must be self_hosted_only")
            parsed = urlparse(str(value.get("base_url", "")))
            if parsed.hostname not in {"127.0.0.1", "::1"}:
                raise ValueError(
                    "Mattermost base_url must resolve explicitly to loopback"
                )
            if parsed.scheme not in {"http", "https"}:
                raise ValueError("Mattermost base_url must use HTTP(S)")
            exact_host = parsed.hostname or ""
            scheme = parsed.scheme
            port = parsed.port or (443 if scheme == "https" else 80)
        elif program_id == "files":
            if mode != "bounded_production":
                raise ValueError("Files.com mode must be bounded_production")
            exact_host = str(value.get("assigned_host", "")).lower().rstrip(".")
            if not exact_host.endswith(".files.com") or exact_host in {
                "app.files.com",
                "www.files.com",
                "developers.files.com",
                "status.files.com",
                "mail.files.com",
            }:
                raise ValueError(
                    "Files.com assigned_host must be your exact assigned trial subdomain"
                )
            scheme, port = "https", 443
            if value.get("company_name_must_contain") != "[BUGBOUNTY]":
                raise ValueError("Files.com company marker must remain [BUGBOUNTY]")
        else:
            if mode != "bounded_production":
                raise ValueError("Amazon mode must be bounded_production")
            exact_host = str(value.get("marketplace_host", "")).lower().rstrip(".")
            if not self._is_amazon_marketplace(exact_host):
                raise ValueError(
                    "Amazon marketplace_host is not in the encoded marketplace list"
                )
            scheme, port = "https", 443

        username = str(value.get("hackerone_username", ""))
        email = str(value.get("test_email", ""))
        user_agent = str(value.get("required_user_agent", ""))
        known_urls_value = value.get("known_urls", [])
        methods_value = value.get("allowed_methods", [])
        max_rps = float(value.get("max_requests_per_second", 0))
        hard_max = float(value.get("hard_program_max_rps", max_rps))
        budget = value.get("request_budget", 0)

        identity_text = f"{username} {email} {user_agent} {exact_host}".upper()
        if require_ready and any(
            marker.upper() in identity_text for marker in PLACEHOLDER_MARKERS
        ):
            raise ValueError(
                f"Fill HackerOne identity/assigned host placeholders for {program_id} before live execution"
            )
        if not isinstance(known_urls_value, list) or not all(
            isinstance(item, str) for item in known_urls_value
        ):
            raise TypeError(f"{program_id}.known_urls must be a list of URLs")
        if not isinstance(methods_value, list) or not all(
            isinstance(item, str) for item in methods_value
        ):
            raise TypeError(f"{program_id}.allowed_methods must be a list")
        methods = frozenset(item.upper() for item in methods_value)
        if program_id != "mattermost" and not methods.issubset(REMOTE_SAFE_METHODS):
            raise ValueError(
                f"{program_id} remote autonomous methods must be read-only"
            )
        if max_rps <= 0 or max_rps > hard_max:
            raise ValueError(f"{program_id} rate exceeds its encoded hard limit")
        if program_id == "files" and hard_max > 2:
            raise ValueError("Files.com hard rate cannot exceed 2 RPS")
        if program_id == "amazon" and hard_max > 5:
            raise ValueError("Amazon hard rate cannot exceed 5 RPS")
        if not isinstance(budget, int) or not 1 <= budget <= 50:
            raise ValueError(f"{program_id} request_budget must be 1-50")
        if program_id == "amazon" and not user_agent.startswith("amazonvrpresearcher_"):
            raise ValueError("Amazon User-Agent must use amazonvrpresearcher_USERNAME")
        if not email.endswith("@wearehackerone.com"):
            raise ValueError(f"{program_id} test_email must use HackerOne alias")

        profile = ProgramProfile(
            program_id=program_id,
            display_name=str(value.get("display_name", program_id)),
            mode=mode,
            exact_host=exact_host,
            scheme=scheme,
            port=port,
            required_user_agent=user_agent,
            max_rps=max_rps,
            hard_max_rps=hard_max,
            request_budget=budget,
            allowed_methods=methods,
            known_urls=tuple(known_urls_value),
            test_email=email,
            hackerone_username=username,
        )
        ProgramPolicy(profile).validate_known_urls()
        return profile

    @staticmethod
    def _is_amazon_marketplace(host: str) -> bool:
        roots = {
            "amazon.com",
            "amazon.co.uk",
            "amazon.in",
            "amazon.de",
            "amazon.fr",
            "amazon.co.jp",
            "amazon.ca",
            "amazon.cn",
            "amazon.it",
            "amazon.es",
            "amazon.nl",
            "amazon.ae",
            "amazon.sg",
            "amazon.se",
            "amazon.sa",
            "amazon.eg",
            "amazon.pl",
            "amazon.com.au",
            "amazon.com.tr",
            "amazon.com.br",
            "amazon.com.mx",
            "amazon.com.be",
            "amazon.co.za",
            "amazon.com.ng",
            "amazon.com.co",
            "amazon.cl",
        }
        return any(
            host == root or host.endswith(f".{root}") for root in roots
        ) and not any(
            marker in host
            for marker in ("aws", ".a2z.", "test", "qa", "preprod", "gamma", "beta")
        )


class ProgramPolicy:
    def __init__(self, profile: ProgramProfile):
        self.profile = profile
        self._known = {self._url_identity(url): url for url in profile.known_urls}

    def validate_known_urls(self) -> None:
        for url in self.profile.known_urls:
            self.validate_request(
                RequestSpec(name="known-url-validation", method="GET", url=url),
                check_query_keys=False,
            )

    def validate_plan(self, requests: list[RequestSpec]) -> None:
        if len(requests) > self.profile.request_budget:
            raise ValueError(
                f"{self.profile.program_id} plan exceeds request budget {self.profile.request_budget}"
            )
        names: set[str] = set()
        for request in requests:
            if request.name in names:
                raise ValueError("Request names must be unique within each plan")
            names.add(request.name)
            self.validate_request(request)

    def validate_request(
        self, request: RequestSpec, *, check_query_keys: bool = True
    ) -> None:
        method = request.method.upper()
        if method not in self.profile.allowed_methods:
            raise PermissionError(
                f"Method {method} is not allowed for {self.profile.program_id}"
            )
        parsed = urlparse(request.url)
        if (
            parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
        ):
            raise PermissionError("URL userinfo and fragments are forbidden")
        if parsed.scheme != self.profile.scheme:
            raise PermissionError("URL scheme does not match the program profile")
        host = (parsed.hostname or "").lower().rstrip(".")
        if host != self.profile.exact_host:
            raise PermissionError(
                f"Host {host!r} is outside the exact configured scope"
            )
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port != self.profile.port:
            raise PermissionError("URL port is outside the exact configured scope")
        if self.profile.program_id != "mattermost":
            lowered_parts = {part.lower() for part in parsed.path.split("/") if part}
            if lowered_parts & BLOCKED_REMOTE_PATH_WORDS:
                raise PermissionError(
                    "Remote autonomous plan contains a blocked stateful path"
                )
            if request.body:
                raise PermissionError(
                    "Remote autonomous requests cannot contain a body"
                )
        identity = self._url_identity(request.url)
        if identity not in self._known:
            raise PermissionError(
                "Autonomous plans may only use paths listed in known_urls"
            )
        if check_query_keys:
            known_query_keys = {
                key.lower()
                for key, _ in parse_qsl(
                    urlparse(self._known[identity]).query, keep_blank_values=True
                )
            }
            requested_keys = {
                key.lower()
                for key, _ in parse_qsl(parsed.query, keep_blank_values=True)
            }
            if not requested_keys.issubset(known_query_keys):
                raise PermissionError(
                    "Plan introduced a query parameter not present in known_urls"
                )
            if requested_keys & BLOCKED_QUERY_KEYS:
                raise PermissionError(
                    "Plan contains a blocked sensitive query parameter"
                )

    @staticmethod
    def _url_identity(url: str) -> str:
        parsed = urlparse(url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        return f"{parsed.scheme.lower()}://{(parsed.hostname or '').lower()}:{port}{parsed.path or '/'}"


class PlanLoader:
    @staticmethod
    def load(path: Path, program_id: str) -> list[RequestSpec]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"Cannot load plan {path}: {exc}") from exc
        if not isinstance(value, dict) or value.get("program") != program_id:
            raise ValueError(f"Plan {path} must declare program={program_id}")
        items = value.get("requests")
        if not isinstance(items, list):
            raise TypeError(f"Plan {path} requests must be a list")
        requests: list[RequestSpec] = []
        for item in items:
            if not isinstance(item, dict):
                raise TypeError("Every plan request must be an object")
            requests.append(
                RequestSpec(
                    name=str(item.get("name", ""))[:100],
                    method=str(item.get("method", "GET")).upper(),
                    url=str(item.get("url", ""))[:2048],
                    expected_observation=str(item.get("expected_observation", ""))[
                        :500
                    ],
                    body=str(item.get("body", ""))[:10000],
                )
            )
        return requests


class BoundedAIPlanner:
    """Generate a constrained plan; deterministic policy remains authoritative."""

    SYSTEM = (
        "You are a defensive bug-bounty planning assistant. Return only JSON. "
        "Never invent paths or query keys, never add credentials, never propose brute force, "
        "state changes, post-exploitation, denial of service, payload spraying, or access to other users."
    )

    def __init__(self, config: MultiProgramConfig):
        value = config.global_config.get("llm", {})
        if not isinstance(value, dict):
            raise TypeError("global.llm must be a mapping")
        self.endpoint = str(value.get("endpoint", ""))
        parsed = urlparse(self.endpoint)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("AI planning endpoint must be absolute HTTPS")
        key_env = str(value.get("api_key_env", "AGENT_API_KEY"))
        self.api_key = os.environ.get(key_env, "")
        if not self.api_key:
            raise ValueError(f"Set {key_env} before generating AI plans")
        self.auth_mode = str(value.get("auth_mode", "anthropic"))
        if self.auth_mode not in {"anthropic", "bearer"}:
            raise ValueError("AI auth_mode must be anthropic or bearer")
        self.model = str(value.get("model", ""))
        self.max_tokens = min(max(int(value.get("max_tokens", 2000)), 1), 4096)
        self.temperature = min(max(float(value.get("temperature", 0.1)), 0.0), 1.0)

    def generate(self, profile: ProgramProfile, objective: str) -> list[RequestSpec]:
        prompt = f"""Create a minimal request plan for program {profile.program_id}.
Mode: {profile.mode}
Exact host: {profile.exact_host}
Allowed methods: {sorted(profile.allowed_methods)}
Maximum requests: {profile.request_budget}
Known URLs (the URL path and query-key set are immutable):
{json.dumps(profile.known_urls, indent=2)}
Research objective:
{objective[:1000]}

Return exactly:
{{"program":"{profile.program_id}","requests":[{{"name":"...","method":"GET","url":"one exact known URL","expected_observation":"...","body":""}}]}}
It is valid to return an empty requests list. Use at most one baseline request per known URL.
"""
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.auth_mode == "anthropic":
            headers["x-api-key"] = self.api_key
            headers["anthropic-version"] = "2023-06-01"
            payload = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "system": self.SYSTEM,
                "messages": [{"role": "user", "content": prompt}],
            }
        else:
            headers["Authorization"] = f"Bearer {self.api_key}"
            payload = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "messages": [
                    {"role": "system", "content": self.SYSTEM},
                    {"role": "user", "content": prompt},
                ],
            }
        try:
            response = requests.post(
                self.endpoint,
                headers=headers,
                json=payload,
                timeout=60,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise ConnectionError(f"AI plan request failed: {exc}") from exc
        if response.status_code in {301, 302, 303, 307, 308}:
            raise ValueError("AI endpoint redirect refused")
        if not 200 <= response.status_code < 300:
            raise ValueError(f"AI endpoint returned HTTP {response.status_code}")
        try:
            data = response.json()
        except ValueError as exc:
            raise ValueError("AI endpoint returned invalid JSON") from exc
        content = data.get("content")
        if isinstance(content, list):
            text = "".join(
                str(item.get("text", "")) for item in content if isinstance(item, dict)
            )
        else:
            choices = data.get("choices")
            text = ""
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message", {})
                if isinstance(message, dict):
                    text = str(message.get("content", ""))
        value = self._extract_json(text)
        if value.get("program") != profile.program_id or not isinstance(
            value.get("requests"), list
        ):
            raise ValueError("AI returned a malformed or wrong-program plan")
        requests_out: list[RequestSpec] = []
        for item in value["requests"]:
            if not isinstance(item, dict):
                raise TypeError("AI plan request entries must be objects")
            requests_out.append(
                RequestSpec(
                    name=str(item.get("name", ""))[:100],
                    method=str(item.get("method", "GET")).upper(),
                    url=str(item.get("url", ""))[:2048],
                    expected_observation=str(item.get("expected_observation", ""))[
                        :500
                    ],
                    body=str(item.get("body", ""))[:10000],
                )
            )
        ProgramPolicy(profile).validate_plan(requests_out)
        return requests_out

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        decoder = json.JSONDecoder()
        for index, character in enumerate(text):
            if character != "{":
                continue
            try:
                value, _ = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
        raise ValueError("AI response contains no JSON plan")

    @staticmethod
    def save(path: Path, program_id: str, requests_out: list[RequestSpec]) -> None:
        value = {
            "program": program_id,
            "requests": [asdict(request) for request in requests_out],
        }
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(path)


class SensitiveDataGuard:
    JSON_SENSITIVE = re.compile(
        r'(?i)"(?:email|phone|mobile|iban|ssn|social_security|date_of_birth|password|access_token|refresh_token)"\s*:'
    )

    @classmethod
    def detect(cls, raw_response: str) -> str | None:
        _, _, body = raw_response.replace("\r\n", "\n").partition("\n\n")
        if cls.JSON_SENSITIVE.search(body):
            return "response appears to contain sensitive structured data"
        return None


class Redactor:
    HEADER = re.compile(
        r"(?im)^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token):[^\r\n]*$"
    )
    EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)

    @classmethod
    def apply(cls, value: str) -> str:
        value = cls.HEADER.sub(lambda match: f"{match.group(1)}: [REDACTED]", value)
        return cls.EMAIL.sub("[EMAIL_REDACTED]", value)


class OfficialBurpMCPExecutor:
    TOOL = "send_http1_request"

    def __init__(self, endpoint: str, timeout: int):
        parsed = urlparse(endpoint)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
            "127.0.0.1",
            "::1",
        }:
            raise ValueError("Official Burp MCP endpoint must be loopback")
        self.endpoint = endpoint
        self.timeout = timeout

    @staticmethod
    def _http_factory(
        headers: dict[str, str] | None = None,
        timeout: Any = None,
        auth: Any = None,
    ) -> httpx2.AsyncClient:
        return httpx2.AsyncClient(
            headers=headers,
            timeout=timeout,
            auth=auth,
            follow_redirects=False,
            trust_env=False,
        )

    def send(self, profile: ProgramProfile, request: RequestSpec) -> str:
        return asyncio.run(self._send(profile, request))

    async def _send(self, profile: ProgramProfile, request: RequestSpec) -> str:
        parsed = urlparse(request.url)
        target = parsed.path or "/"
        if parsed.query:
            target += f"?{parsed.query}"
        content = (
            f"{request.method.upper()} {target} HTTP/1.1\r\n"
            f"Host: {profile.exact_host}\r\n"
            f"User-Agent: {profile.required_user_agent}\r\n"
            "Accept: */*\r\n"
            "Connection: close\r\n\r\n"
            f"{request.body}"
        )
        arguments = {
            "content": content,
            "targetHostname": profile.exact_host,
            "targetPort": profile.port,
            "usesHttps": profile.scheme == "https",
        }
        async with (
            sse_client(
                self.endpoint,
                timeout=float(self.timeout),
                sse_read_timeout=float(self.timeout),
                httpx_client_factory=self._http_factory,
            ) as (read_stream, write_stream),
            ClientSession(
                read_stream,
                write_stream,
                read_timeout_seconds=float(self.timeout),
            ) as session,
        ):
            await session.initialize()
            tools = await session.list_tools()
            if self.TOOL not in {tool.name for tool in tools.tools}:
                raise RuntimeError(
                    "Official Burp MCP does not expose send_http1_request"
                )
            result = await session.call_tool(self.TOOL, arguments=arguments)
        if not isinstance(result, CallToolResult) or result.is_error:
            raise RuntimeError("Official Burp MCP request tool returned an error")
        texts = [item.text for item in result.content if isinstance(item, TextContent)]
        response = "\n".join(texts)
        if "denied by Burp Suite" in response:
            raise PermissionError(response)
        return response


class AuditLog:
    def __init__(self, directory: Path, run_id: str):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / f"run-{run_id}.jsonl"
        self._lock = threading.Lock()

    def append(self, value: dict[str, Any]) -> None:
        line = json.dumps(value, ensure_ascii=False, default=str)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            try:
                self.path.chmod(0o600)
            except OSError:
                pass


class DuplicateRegistry:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS findings (
                    program_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    vuln_type TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    parameter TEXT NOT NULL,
                    root_cause TEXT NOT NULL,
                    status TEXT NOT NULL,
                    report_id TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (program_id, fingerprint)
                )
                """
            )
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def fingerprint(
        vuln_type: str, endpoint: str, parameter: str, root_cause: str
    ) -> str:
        normalized_endpoint = re.sub(r"\b\d+\b", "{id}", endpoint.lower().strip())
        normalized_endpoint = re.sub(
            r"[0-9a-f]{8}-[0-9a-f-]{27,}", "{uuid}", normalized_endpoint
        )
        canonical = "|".join(
            re.sub(r"\s+", " ", value.strip().lower())
            for value in (vuln_type, normalized_endpoint, parameter, root_cause)
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    def reserve(
        self,
        program_id: str,
        vuln_type: str,
        endpoint: str,
        parameter: str,
        root_cause: str,
    ) -> tuple[bool, str]:
        fingerprint = self.fingerprint(vuln_type, endpoint, parameter, root_cause)
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO findings
                    (program_id, fingerprint, vuln_type, endpoint, parameter, root_cause, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?)
                    """,
                    (
                        program_id,
                        fingerprint,
                        vuln_type,
                        endpoint,
                        parameter,
                        root_cause,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            return True, fingerprint
        except sqlite3.IntegrityError:
            return False, fingerprint

    def mark(
        self, program_id: str, fingerprint: str, status: str, report_id: str = ""
    ) -> None:
        if status not in {
            "candidate",
            "verified",
            "submitted",
            "duplicate",
            "rejected",
        }:
            raise ValueError("Invalid duplicate-registry status")
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE findings SET status=?, report_id=? WHERE program_id=? AND fingerprint=?",
                (status, report_id or None, program_id, fingerprint),
            )
            if cursor.rowcount != 1:
                raise ValueError("Finding fingerprint was not found")

    def rows(self) -> list[tuple[Any, ...]]:
        with self._connect() as connection:
            return list(
                connection.execute(
                    "SELECT program_id, fingerprint, vuln_type, endpoint, parameter, status, report_id "
                    "FROM findings ORDER BY created_at"
                )
            )


class ProgramRunner:
    def __init__(
        self,
        profile: ProgramProfile,
        requests: list[RequestSpec],
        executor: OfficialBurpMCPExecutor,
        audit: AuditLog,
        dry_run: bool,
    ):
        self.profile = profile
        self.requests = requests
        self.executor = executor
        self.audit = audit
        self.dry_run = dry_run

    def run(self) -> ProgramRunResult:
        policy = ProgramPolicy(self.profile)
        policy.validate_plan(self.requests)
        result = ProgramRunResult(program_id=self.profile.program_id, status="complete")
        interval = 1.0 / self.profile.max_rps
        last_request = 0.0
        for request in self.requests:
            request_result = RequestResult(
                program_id=self.profile.program_id,
                request_name=request.name,
                url=request.url,
                status="validated",
                policy_message="deterministic policy passed",
            )
            if self.dry_run:
                request_result.status = "dry-run"
                result.requests.append(request_result)
                self.audit.append(asdict(request_result))
                continue
            wait = interval - (time.monotonic() - last_request)
            if wait > 0:
                time.sleep(wait)
            try:
                raw_response = self.executor.send(self.profile, request)
            except (
                ConnectionError,
                OSError,
                PermissionError,
                RuntimeError,
                ValueError,
            ) as exc:
                request_result.status = "error"
                request_result.policy_message = str(exc)[:500]
                result.requests.append(request_result)
                result.status = "stopped"
                result.stopped_reason = f"MCP request failed: {exc}"
                self.audit.append(asdict(request_result))
                break
            last_request = time.monotonic()
            sensitive = SensitiveDataGuard.detect(raw_response)
            request_result.response_sha256 = hashlib.sha256(
                raw_response.encode("utf-8", errors="replace")
            ).hexdigest()
            request_result.response_preview = Redactor.apply(raw_response)[:1500]
            request_result.status = "sensitive-stop" if sensitive else "complete"
            request_result.policy_message = sensitive or "response captured"
            result.requests.append(request_result)
            self.audit.append(asdict(request_result))
            if sensitive:
                result.status = "stopped"
                result.stopped_reason = sensitive
                break
        return result


class ConcurrentOrchestrator:
    def __init__(self, config: MultiProgramConfig, plans_dir: Path, dry_run: bool):
        self.config = config
        self.plans_dir = plans_dir
        self.dry_run = dry_run
        self.run_id = str(uuid.uuid4())
        self.audit = AuditLog(config.audit_dir(), self.run_id)
        self.executor = OfficialBurpMCPExecutor(
            config.mcp_endpoint(), config.mcp_timeout()
        )

    def prepare(self) -> list[tuple[ProgramProfile, list[RequestSpec]]]:
        prepared: list[tuple[ProgramProfile, list[RequestSpec]]] = []
        for program_id in PROGRAM_IDS:
            profile = self.config.profile(program_id, require_ready=not self.dry_run)
            plan_path = self.plans_dir / f"{program_id}.json"
            requests = PlanLoader.load(plan_path, program_id)
            ProgramPolicy(profile).validate_plan(requests)
            prepared.append((profile, requests))
        return prepared

    def run(self) -> list[ProgramRunResult]:
        prepared = self.prepare()
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=3, thread_name_prefix="bounty-program"
        ) as pool:
            futures = [
                pool.submit(
                    ProgramRunner(
                        profile,
                        requests,
                        self.executor,
                        self.audit,
                        self.dry_run,
                    ).run
                )
                for profile, requests in prepared
            ]
            return [future.result() for future in futures]


def display_profiles(config: MultiProgramConfig, require_ready: bool) -> None:
    table = Table(show_header=True, box=box.ROUNDED)
    for column in ("Program", "Mode", "Exact host", "RPS", "Budget", "Methods"):
        table.add_column(column)
    for program_id in PROGRAM_IDS:
        profile = config.profile(program_id, require_ready=require_ready)
        table.add_row(
            profile.display_name,
            profile.mode,
            profile.exact_host,
            str(profile.max_rps),
            str(profile.request_budget),
            ",".join(sorted(profile.allowed_methods)),
        )
    console.print(table)


def display_run(results: list[ProgramRunResult], audit_path: Path) -> None:
    table = Table(show_header=True, box=box.ROUNDED)
    table.add_column("Program")
    table.add_column("Status")
    table.add_column("Requests")
    table.add_column("Stop reason")
    for result in results:
        table.add_row(
            result.program_id,
            result.status,
            str(len(result.requests)),
            result.stopped_reason[:100],
        )
    console.print(table)
    console.print(f"Audit log: [cyan]{audit_path}[/cyan]")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run policy-bounded Mattermost/Files/Amazon agents concurrently"
    )
    parser.add_argument("--config", default="multi_program_config.yaml")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("validate")

    generate = subparsers.add_parser("generate-plans")
    generate.add_argument("--program", choices=[*PROGRAM_IDS, "all"], default="all")
    generate.add_argument("--plans-dir", default="plans")
    generate.add_argument(
        "--objective",
        default="Create minimal non-destructive baseline observations for known URLs",
    )
    generate.add_argument(
        "--approve-ai-send",
        action="store_true",
        help="approve sending only profile metadata, known URLs, and the objective to the configured AI provider",
    )

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--plans-dir", default="plans")
    run_parser.add_argument("--dry-run", action="store_true")
    run_parser.add_argument(
        "--approve",
        action="store_true",
        help="acknowledge the validated plans and permit official Burp MCP execution",
    )

    dedupe = subparsers.add_parser("dedupe-check")
    dedupe.add_argument("--program", choices=PROGRAM_IDS, required=True)
    dedupe.add_argument("--vuln-type", required=True)
    dedupe.add_argument("--endpoint", required=True)
    dedupe.add_argument("--parameter", default="")
    dedupe.add_argument("--root-cause", required=True)

    mark = subparsers.add_parser("dedupe-mark")
    mark.add_argument("--program", choices=PROGRAM_IDS, required=True)
    mark.add_argument("--fingerprint", required=True)
    mark.add_argument(
        "--status",
        choices=["candidate", "verified", "submitted", "duplicate", "rejected"],
        required=True,
    )
    mark.add_argument("--report-id", default="")

    subparsers.add_parser("dedupe-list")
    parser.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        config = MultiProgramConfig(args.config)
        registry = DuplicateRegistry(config.duplicate_db())
        if args.command == "validate":
            display_profiles(config, require_ready=False)
            console.print(
                Panel(
                    "Mattermost is loopback-only. Files.com/Amazon are exact-host, read-only, bounded-production profiles.\n"
                    "Local duplicate prevention is enabled; platform-side duplicates remain unknown until triage.",
                    title="Policy validation passed",
                    border_style="green",
                )
            )
            return 0
        if args.command == "generate-plans":
            if not args.approve_ai_send:
                raise ValueError("AI plan generation requires --approve-ai-send")
            planner = BoundedAIPlanner(config)
            selected = list(PROGRAM_IDS) if args.program == "all" else [args.program]
            profiles = [
                config.profile(program_id, require_ready=True)
                for program_id in selected
            ]
            with concurrent.futures.ThreadPoolExecutor(
                max_workers=min(3, len(profiles)), thread_name_prefix="plan-agent"
            ) as pool:
                future_map = {
                    pool.submit(planner.generate, profile, args.objective): profile
                    for profile in profiles
                }
                for future, profile in future_map.items():
                    requests_out = future.result()
                    output = Path(args.plans_dir) / f"{profile.program_id}.json"
                    planner.save(output, profile.program_id, requests_out)
                    console.print(
                        f"[green]{profile.program_id}: wrote {len(requests_out)} validated request(s) to {output}[/green]"
                    )
            console.print(
                "[yellow]Review every generated plan before any live run. AI plan output is not authorization.[/yellow]"
            )
            return 0
        if args.command == "run":
            if not args.dry_run and not args.approve:
                raise ValueError(
                    "Live execution requires --approve after reviewing all three JSON plans"
                )
            orchestrator = ConcurrentOrchestrator(
                config, Path(args.plans_dir), dry_run=args.dry_run
            )
            display_profiles(config, require_ready=not args.dry_run)
            results = orchestrator.run()
            display_run(results, orchestrator.audit.path)
            return 0 if all(result.status == "complete" for result in results) else 2
        if args.command == "dedupe-check":
            is_new, fingerprint = registry.reserve(
                args.program,
                args.vuln_type,
                args.endpoint,
                args.parameter,
                args.root_cause,
            )
            console.print(
                f"Fingerprint: [cyan]{fingerprint}[/cyan]\n"
                + (
                    "[green]NEW locally — manual verification is still required.[/green]"
                    if is_new
                    else "[red]LOCAL DUPLICATE — do not create another report from this workspace.[/red]"
                )
            )
            return 0 if is_new else 3
        if args.command == "dedupe-mark":
            registry.mark(args.program, args.fingerprint, args.status, args.report_id)
            console.print("[green]Duplicate registry updated.[/green]")
            return 0
        if args.command == "dedupe-list":
            table = Table(show_header=True, box=box.ROUNDED)
            for name in (
                "Program",
                "Fingerprint",
                "Type",
                "Endpoint",
                "Parameter",
                "Status",
                "Report ID",
            ):
                table.add_column(name)
            for row in registry.rows():
                table.add_row(*[str(value or "")[:80] for value in row])
            console.print(table)
            return 0
    except (OSError, TypeError, ValueError, PermissionError, RuntimeError) as exc:
        console.print(f"[red]Error: {exc}[/red]")
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
