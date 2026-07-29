#!/usr/bin/env python3
# ruff: noqa: I001
"""Safely fill non-secret identity fields for the three-program runner."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from multi_program_agent import MultiProgramConfig


USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{2,64}$")
FILES_EXCLUDED = {
    "app.files.com",
    "www.files.com",
    "developers.files.com",
    "status.files.com",
    "mail.files.com",
}


def ask(value: str | None, prompt: str, default: str | None = None) -> str:
    if value:
        return value.strip()
    suffix = f" [{default}]" if default else ""
    entered = input(f"{prompt}{suffix}: ").strip()
    return entered or (default or "")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fill HackerOne username and exact assigned hosts without storing credentials"
    )
    parser.add_argument("--config", default="multi_program_config.yaml")
    parser.add_argument("--template", default="multi_program_config.example.yaml")
    parser.add_argument("--h1-username")
    parser.add_argument("--files-host")
    parser.add_argument("--amazon-host")
    parser.add_argument("--mattermost-url", default="http://127.0.0.1:8065")
    parser.add_argument("--non-interactive", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = Path(args.config)
    source_path = config_path if config_path.exists() else Path(args.template)
    if not source_path.is_file():
        raise SystemExit(f"Configuration template not found: {source_path}")
    value = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("programs"), dict):
        raise SystemExit("Invalid multi-program configuration")

    if args.non_interactive and not all(
        (args.h1_username, args.files_host, args.amazon_host)
    ):
        raise SystemExit(
            "--non-interactive requires --h1-username, --files-host, and --amazon-host"
        )

    username = ask(args.h1_username, "HackerOne username")
    if not USERNAME_RE.fullmatch(username):
        raise SystemExit("HackerOne username contains unsupported characters")
    files_host = (
        ask(
            args.files_host,
            "Exact Files.com trial hostname (without https://)",
        )
        .lower()
        .rstrip(".")
    )
    if (
        not files_host.endswith(".files.com")
        or files_host in FILES_EXCLUDED
        or "*" in files_host
        or "/" in files_host
    ):
        raise SystemExit("Files hostname is not an assigned trial subdomain")
    amazon_host = (
        ask(
            args.amazon_host,
            "One exact Amazon marketplace hostname (without https://)",
            "www.amazon.com",
        )
        .lower()
        .rstrip(".")
    )
    mattermost_url = ask(
        args.mattermost_url,
        "Researcher-owned Mattermost loopback URL",
        "http://127.0.0.1:8065",
    )

    alias = f"{username}@wearehackerone.com"
    programs = value["programs"]
    programs["mattermost"].update(
        {
            "hackerone_username": username,
            "test_email": alias,
            "required_user_agent": f"H1Research/{username}",
            "base_url": mattermost_url,
        }
    )
    programs["files"].update(
        {
            "hackerone_username": username,
            "test_email": alias,
            "required_user_agent": f"H1Research/{username}",
            "assigned_host": files_host,
        }
    )
    programs["amazon"].update(
        {
            "hackerone_username": username,
            "test_email": alias,
            "required_user_agent": f"amazonvrpresearcher_{username}",
            "marketplace_host": amazon_host,
        }
    )

    if config_path.exists():
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = config_path.with_name(f"{config_path.name}.{timestamp}.bak")
        shutil.copy2(config_path, backup)
        print(f"Backup: {backup}")
    config_path.write_text(
        yaml.safe_dump(value, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    config_path.chmod(0o600)

    # Validate all live identity and host constraints before declaring success.
    config = MultiProgramConfig(str(config_path))
    for program_id in ("mattermost", "files", "amazon"):
        config.profile(program_id, require_ready=True)

    print(f"Configured: {config_path}")
    print(f"HackerOne alias: {alias}")
    print("No password, cookie, token, OTP, or payment information was stored.")
    print("Next: add only previously observed URLs to known_urls, then run:")
    print("  .venv/bin/python multi_program_agent.py validate")
    print("  .venv/bin/python multi_program_agent.py run --dry-run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
