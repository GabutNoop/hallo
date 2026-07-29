# Concurrent Mattermost, Files.com, and Amazon agents

`multi_program_agent.py` runs three policy-isolated workers concurrently through
PortSwigger's official MCP Server. It implements the selected **compliant
hybrid** mode:

| Program | Active mode | Default target policy | Rate |
|---|---|---|---:|
| Mattermost | Researcher-owned self-hosted instance only | Explicit loopback (`127.0.0.1`) | 2 RPS |
| Files.com | Bounded production | Exact assigned trial subdomain, read-only methods | 1 RPS (program hard cap encoded as 2) |
| Amazon VRP | Bounded production | One exact selected marketplace host, read-only methods | 1 RPS (program hard cap encoded as 5) |

The runner does not perform discovery, crawling, brute force, path guessing,
parameter discovery, or post-exploitation. Every autonomous URL must first be
placed in `known_urls`, and its path cannot be changed by a plan. Files.com and
Amazon plans are limited to `GET`, `HEAD`, and `OPTIONS` with empty bodies.
State-changing testing stays manual. Mattermost's broader method set is usable
only against the researcher's loopback self-hosted instance.

## Why these restrictions exist

- Mattermost permits disruptive research on a researcher-owned self-hosted
  installation, but automated output must still be manually verified.
- Files.com permits heavily rate-limited automated tools around 2 RPS, while
  prohibiting brute force, automation of intended functionality, access to
  other users, and elevated-privilege findings.
- Amazon permits limited automated tools up to 5 RPS with its required
  researcher User-Agent, own accounts, minimum necessary validation, and no
  post-exploitation.

The configured rates are deliberately below the published maxima.

## Installation

```bash
./scripts/install_three_program_tools.sh
```

The installer:

1. creates `.venv` and installs `requirements.txt`;
2. installs the pinned official PortSwigger MCP extension when the release
   asset is reachable, or directs you to Burp's official BApp Store;
3. clones Mattermost's official Docker deployment repository at a pinned
   commit;
4. creates local config and plan files if they do not already exist.

It deliberately does **not** install scanners or exploitation frameworks.
Docker itself must be installed using Docker's official installation guide.

## Configure identities without sharing secrets

The easiest option is the non-secret configuration helper:

```bash
.venv/bin/python scripts/configure_three_programs.py
```

It asks only for your HackerOne username, exact assigned Files.com trial host,
and one Amazon marketplace host. It derives the HackerOne aliases/User-Agents,
validates all three profiles, creates a timestamped backup when needed, and
writes the configuration with permission `0600`.

Alternatively, edit `multi_program_config.yaml` locally:

- replace `YOUR_H1_USERNAME`;
- replace `YOUR-ASSIGNED-SUBDOMAIN.files.com` with the trial hostname assigned
  to you;
- create the Files.com trial with `[BUGBOUNTY]` in Company Name;
- use HackerOne aliases for all accounts;
- choose one exact Amazon marketplace host;
- add only previously observed, in-scope URLs to `known_urls`.

Do not put passwords, cookies, cards, OTPs, access tokens, or API keys in this
file. Authenticated/state-changing tests remain manual in Burp.

## Optional bounded AI plan generation

After filling identities and `known_urls`, an AI planner can prepare all three
JSON plans concurrently:

```bash
export AGENT_API_KEY='your-provider-key'
.venv/bin/python multi_program_agent.py generate-plans \
  --program all \
  --approve-ai-send \
  --objective 'Create minimal read-only baseline observations for known URLs'
```

Only profile metadata, the objective, and known URLs are sent to the configured
AI provider. The planner cannot execute MCP tools. Every generated request is
passed through the deterministic policy engine before it is written. It cannot
introduce a new host, path, query key, method, body, or exceed the budget. Review
the resulting plans manually before `run --approve`.

## Prepare plans manually

The installer copies:

```text
plans/mattermost.example.json -> plans/mattermost.json
plans/files.example.json      -> plans/files.json
plans/amazon.example.json     -> plans/amazon.json
```

A plan is intentionally simple:

```json
{
  "program": "amazon",
  "requests": [
    {
      "name": "known-page-baseline",
      "method": "GET",
      "url": "https://www.amazon.com/a-path-already-listed-in-known-urls",
      "expected_observation": "Compare a non-sensitive baseline response"
    }
  ]
}
```

The deterministic policy engine validates all three plans before any worker is
started. A failure in any plan prevents the entire live run.

## Validate and dry-run all three concurrently

```bash
.venv/bin/python multi_program_agent.py validate
.venv/bin/python multi_program_agent.py run --dry-run
```

Dry-run creates no target traffic. It verifies the three workers, policies,
plans, request budgets, and audit logging.

## Live concurrent run

Prerequisites:

1. Burp is running with PortSwigger's official MCP Server.
2. MCP is bound to `127.0.0.1`.
3. HTTP request approval remains enabled, or only the three exact configured
   hosts are individually approved in Burp—never use wildcard approval.
4. All plan requests have been reviewed.

Then run:

```bash
.venv/bin/python multi_program_agent.py run --approve
```

`--approve` acknowledges one bounded plan per program. The three workers run in
parallel, but each program remains sequential with concurrency 1 and its own
rate/budget. Every request and redacted response preview is written to an
owner-only JSONL audit file. A structured sensitive-data indicator immediately
stops that program worker.

## Local duplicate prevention

Before preparing a report, reserve a normalized root-cause fingerprint:

```bash
.venv/bin/python multi_program_agent.py dedupe-check \
  --program amazon \
  --vuln-type IDOR \
  --endpoint '/orders/12345' \
  --parameter order_id \
  --root-cause 'missing ownership check in order controller'
```

Numeric IDs and UUIDs in endpoints are normalized, so the same root cause on
another record is flagged as a local duplicate. After human verification:

```bash
.venv/bin/python multi_program_agent.py dedupe-mark \
  --program amazon \
  --fingerprint SHA256_FROM_PREVIOUS_COMMAND \
  --status verified
```

After submitting:

```bash
.venv/bin/python multi_program_agent.py dedupe-mark \
  --program amazon \
  --fingerprint SHA256_FROM_PREVIOUS_COMMAND \
  --status submitted \
  --report-id H1-REPORT-ID
```

List the registry:

```bash
.venv/bin/python multi_program_agent.py dedupe-list
```

This prevents **your own workspace** from creating duplicate reports. It cannot
know private reports submitted by other researchers. Only HackerOne/program
triage can determine external duplicates. Always search available Hacktivity and
submit one root cause per report unless chaining is necessary to show impact.

## Mandatory human verification

The runner never submits reports. Every candidate must be reproduced and
understood by the researcher before submission. Scanner/AI output by itself is
not a valid Mattermost report, and Files.com/Amazon require complete,
reproducible evidence rather than raw automation output.
