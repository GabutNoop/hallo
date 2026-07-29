# hallo

This repository contains three security-agent workflows:

- [`autonomous-agent/`](autonomous-agent/) — the existing sandboxed AI agent.
- [`tab_agent.py`](tab_agent.py) — the passive TAB reporting copilot.
- [`multi_program_agent.py`](multi_program_agent.py) — a policy-bounded concurrent runner for Mattermost self-hosted, a Files.com assigned trial subdomain, and one exact Amazon marketplace host. See [`MULTI_PROGRAM.md`](MULTI_PROGRAM.md).

## Three-program concurrent runner

For the confirmed Mattermost + Files.com + Amazon workflow:

```bash
./scripts/install_three_program_tools.sh
.venv/bin/python multi_program_agent.py validate
.venv/bin/python multi_program_agent.py run --dry-run
```

The runner executes three isolated workers concurrently. Mattermost is restricted
to a loopback self-hosted installation. Files.com is restricted to the exact
assigned trial subdomain and Amazon to one exact marketplace host. Remote workers
allow only GET/HEAD/OPTIONS, one concurrent request, known paths, conservative
rates, and fixed budgets. Live execution requires reviewed plans and `--approve`.
See [`MULTI_PROGRAM.md`](MULTI_PROGRAM.md).

A local SQLite root-cause fingerprint registry prevents this workspace from
creating duplicate reports. It cannot detect private reports from other
researchers; only platform triage can determine those duplicates.

## TAB Bug Bounty Copilot

The copilot parses HTTP messages copied from a proxy, highlights review-worthy observations, calculates strict CVSS 3.1 base scores, stores redacted evidence, checks local compliance fields, and drafts reports. It **does not** scan targets, send payloads, brute-force accounts, or submit reports.

The built-in scope and reward values are a local snapshot supplied by the operator. They are not authoritative. Always verify the current program brief and authorization before testing. The supplied snapshot records a program update on **2025-02-11**.

### Program snapshot encoded by the tool

- Exact web assets only: `https://thueringer-foerderportal.eu` and `https://login.aufbaubank.de`. Every unlisted domain and every third party is out of scope.
- Reports must be submitted through YesWeHack within 24 hours. Full or partial public disclosure is not allowed.
- Accounts, when needed, must be registered with the researcher's YesWeHack email alias.
- The testing User-Agent must contain `-BugBounty-TA-31337`.
- DoS, infrastructure interference, brute force, social engineering, mass automation, and destructive testing are prohibited.
- The local `0.2 requests/s` setting is a conservative tool guardrail, **not** represented as an official numeric program limit.
- Similar/systemic report factors are encoded as 100%, 100%, 75%, 50%, 25%, then 10% for report six and later.
- Credential-leak reports apply the supplied source/impact eligibility matrix. Third-party stolen data is never accepted by the local checker.
- Credential verification must stop at the minimum validity check. Compromised accounts cannot be changed or used for post-authentication testing, and exposed datasets must not be copied.

### Install

```bash
python3 -m venv .venv
. .venv/bin/activate                # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python tab_agent.py --setup
```

`--setup` creates `config.yaml`, `.env.example`, and private evidence directories. It never creates a `.env` containing a token.

### Run

```bash
# Safe default: local analysis only; all outbound LLM calls are blocked
python tab_agent.py

# Optional AI assistance: every outbound request still requires typing "yes"
cp .env.example .env
# Edit .env and set AGENT_API_KEY without committing the file
python tab_agent.py --live

# Other commands
python tab_agent.py --config config.yaml --verbose
python tab_agent.py --import-file capture.har
python tab_agent.py --version
```

### Official PortSwigger Burp MCP, HAR, ZAP, and capture import

Burp integration now uses PortSwigger's official
[`PortSwigger/mcp-server`](https://github.com/PortSwigger/mcp-server) extension
and the official Python MCP SDK. The previous custom Jython extension was
removed.

Install the pinned official JAR from the terminal:

```bash
./scripts/install_portswigger_mcp.sh
```

After loading and enabling it in Burp, verify the exposed tools and import
already captured traffic:

```bash
python tab_agent.py --burp-mcp-tools
python tab_agent.py --live --burp-mcp-import proxy --max-imports 10
python tab_agent.py --live --burp-mcp-import organizer --max-imports 10
```

The MCP adapter is loopback-only and hard-blocks request-sending, Intruder,
Collaborator, Repeater creation, configuration editing, scanner imports, and
all state-changing Burp tools. Only regex-filtered Proxy/Organizer history tools are allowlisted. PortSwigger's data-access approval and
the copilot's own terminal approval are both retained.

Standard HAR files from browsers, OWASP ZAP, or other proxies remain supported:

```bash
python tab_agent.py --import-file browser-or-zap.har
```

File imports are capped at 20 exchanges, 20 MiB per file, and 2 MiB per message.
See [`integrations/README.md`](integrations/README.md).

### Opt-in AI review agents

The interactive menu provides constrained reviewer roles for triage, scope and
policy, CVSS, report quality, and credential-leak policy. Every role is a
separate external request requiring its own explicit approval in `--live` mode.
AI reviewer output is saved as notes and cannot call Burp MCP tools, send target
requests, or automatically modify findings, CVSS, reports, or compliance
declarations.

The default AI endpoint is Anthropic's official Messages API. A custom HTTPS endpoint can be configured explicitly. The provider hostname is shown at each approval gate, redirects are refused, and captured traffic is redacted before transmission. Review the redacted files yourself; automated redaction cannot guarantee removal of every sensitive value.

### Safety properties

- Exact HTTPS hosts only by default; subdomains and non-default ports are not inferred to be in scope.
- Passive parsing only—there is no HTTP client for target testing.
- Dry-run is the default.
- Credentials, cookies, common secret fields, email addresses, IBANs, and phone numbers are redacted in the evidence vault.
- Evidence files use restrictive permissions and atomic writes.
- Compliance claims remain failed until explicitly confirmed by the operator, including first-reporter and employment/contractor eligibility declarations.
- Credential findings require source/impact classification and four additional handling confirmations.
- Reports retain placeholders rather than inventing evidence, impact, or CVSS vectors.
- Report drafts show both the base reward band and any systemic-issue reduction.

### Tests

```bash
python -m unittest discover -s tests -v
```
