# RedOps v2.0 — Real Security Analysis Engine

> Zero-dependency CLI tool for authorized security reconnaissance and assessment.

## Features

- **Real DNS Recon** — A, AAAA, MX, TXT, NS, CNAME resolution
- **Real Port Scanner** — TCP connect scan with concurrency control
- **Real SSL/TLS Analysis** — Certificate chain, cipher, expiry, self-signed detection
- **Real HTTP Analysis** — Security headers scoring, tech fingerprinting, info leakage
- **Real WHOIS/RDAP** — Domain registration data via RDAP protocol
- **Exposed File Detection** — 40+ sensitive file paths checked
- **Persistent Storage** — JSON file-based, survives restarts
- **Rate Limiting** — Built-in throttle (5/sec, 60/min)
- **CLI Tool** — Zero dependencies, works out of the box
- **AI Prompt Generation** — Structured 5-phase security analysis prompts
- **Report Generation** — Risk dashboards, scoring, remediation roadmaps

## Quick Start

```bash
# No npm install needed — zero dependencies!

# Register a target
node src/cli add example.com --owner "Acme Corp"

# Run passive recon
node src/cli recon example.com

# Full assessment
node src/cli scan example.com

# View findings
node src/cli findings example.com

# Generate report
node src/cli report example.com --output report.json

# Generate AI prompt
node src/cli prompt example.com --output prompt.txt
```

## CLI Commands

```
TARGET MANAGEMENT
  add <domain>           Register authorized target
  list / ls              List all registered targets
  remove / rm <domain>   Remove target and all data

RECONNAISSANCE
  recon <domain>         Passive recon (DNS, headers, SSL, WHOIS)
  ports <domain>         TCP port scan (--profile web|full)
  files <domain>         Detect exposed sensitive files
  scan <domain>          Full assessment (recon + ports + files)

FINDINGS
  findings <domain>      List findings (--severity, --status)

REPORTS
  report <domain>        Generate security report
  prompt <domain>        Generate AI analysis prompt
  export                 Export all data as JSON

GLOBAL OPTIONS
  --json                 JSON output
  --data-dir <path>      Custom data directory
  --verbose              Verbose logging
  --help                 Show help
```

## Examples

```bash
# Register with metadata
node src/cli add target.com --owner "My Company" --scope "Web + API" --auth "Written Auth"

# Recon with JSON output
node src/cli recon target.com --json

# Full port scan
node src/cli ports target.com --profile full --timeout 5000

# Full assessment
node src/cli scan target.com --full --timeout 15000

# Filter findings
node src/cli findings target.com --severity critical --json

# Save report
node src/cli report target.com --output report.json

# Save AI prompt
node src/cli prompt target.com --output prompt.txt
```

## Project Structure

```
├── src/
│   ├── cli/
│   │   └── index.js              # CLI entry point with all commands
│   ├── index.js                  # RedOps orchestrator (v2)
│   ├── net/
│   │   └── index.js              # Real network modules (DNS, TCP, SSL, HTTP, RDAP)
│   ├── storage/
│   │   └── index.js              # Persistent JSON file storage
│   ├── prompts/
│   │   └── masterSecurityPrompt.js  # AI prompt builder
│   ├── report/
│   │   └── index.js              # Report generator
│   ├── models/
│   │   ├── target.js             # Target model
│   │   ├── finding.js            # Finding model
│   │   └── vps.js                # VPS model
│   ├── recon/
│   │   └── index.js              # Recon helpers
│   ├── scanner/
│   │   └── index.js              # Scanner with HITL workflow
│   ├── utils/
│   │   └── logger.js             # Structured logger
│   └── __tests__/
│       └── test.js               # Test suite (real network tests)
├── docs/
│   └── install-claude-code.md    # Claude Code setup guide (ID)
├── data/                         # Persistent data (auto-created)
└── package.json
```

## Network Modules (Real)

| Module | Description | Method |
|--------|-------------|--------|
| `resolveDns(domain)` | Full DNS resolution | `dns` built-in |
| `scanPorts(host, ports)` | TCP connect scan | `net.Socket` |
| `analyzeSsl(host)` | Certificate inspection | `tls.connect` |
| `analyzeHeaders(url)` | HTTP header analysis | `https.request` |
| `detectExposedFiles(url)` | Sensitive file detection | `https.request` |
| `whoisRdap(domain)` | RDAP domain lookup | RDAP protocol |

## Rate Limiting

Built-in rate limiter prevents overwhelming targets:
- **5 requests/second** default
- **60 requests/minute** default
- Configurable via constructor options

## Security Rules

1. Only analyze **authorized** targets
2. Never pivot to external systems
3. Active exploitation requires HITL approval
4. No destructive payloads
5. Stop if PII/credentials discovered — report immediately

## Testing

```bash
# Run all tests (includes real network tests)
npm test
```

## Documentation

- [Cara Install Claude Code](docs/install-claude-code.md) — Panduan setup (Bahasa Indonesia)

## License

MIT
