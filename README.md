# RedOps — Security Analysis Orchestrator

> Authorized security assessment framework with AI-powered prompt generation.

## Overview

RedOps is a Node.js framework for orchestrating security assessments on **authorized targets only**. It provides:

- **Target Registration** — Register and track authorized assessment targets
- **Finding Management** — Log, classify, and triage vulnerability findings
- **VPS Infrastructure Audit** — Analyze server hardening and open ports
- **Master Security Prompt** — Generate comprehensive AI analysis prompts
- **Report Generation** — Produce structured security reports with risk dashboards
- **HITL Workflow** — Human-In-The-Loop approval for all active scans

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd hallo

# Run the demo
npm run demo

# Run tests
npm test
```

## Usage

```javascript
const { RedOps } = require('./src');

const redops = new RedOps();

// Register an authorized target
redops.registerTarget({
  domain: 'example.com',
  owner: 'Acme Corp',
  scope: 'Web Application + API',
  auth_type: 'Written Authorization',
  tech_stack: 'Next.js + Express + PostgreSQL',
});

// Add findings
redops.addFinding('example.com', {
  title: 'JWT Token Not Validated Server-Side',
  severity: 'critical',
  cvss: 9.1,
  owasp: 'A07:2021',
  status: 'confirmed',
  proof: 'JWT with alg:none accepted by /api/v1/admin',
  remediation: 'Validate JWT signature, reject alg:none',
});

// Register VPS infrastructure
redops.registerVPS({
  hostname: 'web-prod-01',
  ip: '203.0.113.42',
  open_ports: [22, 80, 443, 6379],
  hardening_score: 62,
});

// Generate master security prompt for AI analysis
const prompt = redops.generatePrompt('example.com');
console.log(prompt);

// Get risk summary
const summary = redops.getRiskSummary('example.com');
console.log(summary);
```

## Project Structure

```
├── src/
│   ├── index.js              # RedOps orchestrator
│   ├── example.js            # Usage demonstration
│   ├── prompts/
│   │   └── masterSecurityPrompt.js  # AI prompt builder
│   ├── models/
│   │   ├── target.js         # Target model
│   │   ├── finding.js        # Vulnerability finding model
│   │   └── vps.js            # VPS infrastructure model
│   ├── scanner/
│   │   └── index.js          # Scanner with HITL workflow
│   ├── recon/
│   │   └── index.js          # Passive recon module
│   ├── report/
│   │   └── index.js          # Report generator
│   ├── utils/
│   │   └── logger.js         # Structured logger
│   └── __tests__/
│       └── test.js           # Test suite
├── docs/
│   └── install-claude-code.md # Claude Code setup guide (ID)
└── package.json
```

## Modules

### Models
- **Target** — Authorized assessment target with validation
- **Finding** — Vulnerability finding with severity, CVSS, OWASP, MITRE mapping
- **VPS** — Infrastructure node with port risk analysis and health assessment

### Prompt Builder
Generates a structured 5-phase security analysis prompt:
1. **Recon & Surface Mapping** — Entry points, tech fingerprint, auth mechanisms
2. **Threat Modeling** — Attack vectors by category (auth, input, API, infra)
3. **Vulnerability Triage** — Finding analysis with CVSS/OWASP/MITRE mapping
4. **VPS & Infrastructure** — Port audit, hardening review
5. **Report Generation** — Executive summary, risk dashboard, remediation roadmap

### Scanner
- Passive recon (header analysis, tech fingerprinting)
- Active scan requests require **HITL approval**
- Security header analysis with scoring

### Report Generator
- Risk dashboard by category
- Security score calculation (0-100)
- Remediation roadmap (immediate / short-term / medium-term)

## Strict Rules

1. Only analyze authorized targets
2. Never pivot to external systems
3. Flag HITL before ANY active exploitation
4. No destructive payloads
5. Stop if real PII/credentials discovered — report immediately

## Documentation

- [Cara Install Claude Code](docs/install-claude-code.md) — Panduan setup Claude Code (Bahasa Indonesia)

## License

MIT
