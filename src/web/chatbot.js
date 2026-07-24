'use strict';

const { RedOps } = require('..');
const { checkSafety, sanitize, getAllowedOperations } = require('./guard');
const { Logger } = require('../utils/logger');
const path = require('path');

/**
 * RedOps Chatbot — parses natural language and executes safe RedOps commands.
 */
class Chatbot {
  constructor(opts = {}) {
    this.redops = new RedOps({
      dataDir: opts.dataDir || path.join(process.cwd(), 'data'),
      verbose: opts.verbose || false,
    });
    this.logger = new Logger('Chatbot', opts.verbose ? 0 : 1);
    this.sessions = new Map();
  }

  /**
   * Process a user message and return a response.
   * @param {string} message - User input
   * @param {string} [sessionId] - Session identifier
   * @returns {Promise<Object>} Response with text, data, and status
   */
  async processMessage(message, sessionId = 'default') {
    const startTime = Date.now();

    // Safety check FIRST
    const safetyCheck = checkSafety(message);
    if (!safetyCheck.safe) {
      this.logger.warn(`Blocked: ${safetyCheck.reason} | Input: ${message}`);
      return {
        type: 'error',
        text: `🛡️ **BLOCKED** — ${safetyCheck.reason}\n\nSaya tidak bisa menjalankan perintah yang berpotensi merusak sistem VPS. Gunakan perintah RedOps yang aman.`,
        blocked: true,
        timestamp: new Date().toISOString(),
      };
    }

    // Sanitize input
    const input = sanitize(message);

    // Parse command
    const parsed = this._parseCommand(input);
    this.logger.info(`Command: ${parsed.command} | Args: ${JSON.stringify(parsed.args)}`);

    try {
      const result = await this._executeCommand(parsed, sessionId);
      const duration = Date.now() - startTime;

      return {
        type: result.type || 'text',
        text: result.text,
        data: result.data || null,
        duration_ms: duration,
        command: parsed.command,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(`Command error: ${err.message}`);
      return {
        type: 'error',
        text: `❌ **Error:** ${err.message}\n\nKetik \`help\` untuk melihat daftar perintah.`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Parse user input into a command + args.
   * @private
   */
  _parseCommand(input) {
    const parts = input.split(/\s+/);
    const rawCommand = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Natural language mapping
    const nlMap = {
      // Greetings
      'halo': 'help', 'hello': 'help', 'hai': 'help', 'hi': 'help',
      'hey': 'help', 'helo': 'help', 'help': 'help', 'bantuan': 'help',
      'tolong': 'help', '?': 'help',

      // Target management
      'add': 'add', 'tambah': 'add', 'register': 'add', 'daftar': 'add',
      'list': 'list', 'targets': 'list', 'daftar-target': 'list', 'ls': 'list',
      'remove': 'remove', 'hapus': 'remove', 'rm': 'remove', 'delete': 'remove',
      'info': 'info', 'detail': 'info',

      // Recon
      'recon': 'recon', 'rekon': 'recon', 'scan-dns': 'recon', 'cek': 'recon',
      'dns': 'dns', 'resolve': 'dns',
      'headers': 'headers', 'header': 'headers', 'cek-header': 'headers',
      'ssl': 'ssl', 'tls': 'ssl', 'cert': 'ssl', 'sertifikat': 'ssl',
      'whois': 'whois', 'rdap': 'whois',

      // Scanning
      'ports': 'ports', 'port': 'ports', 'scan-port': 'ports', 'port-scan': 'ports',
      'files': 'files', 'file': 'files', 'exposed': 'files', 'sensitif': 'files',
      'scan': 'scan', 'full': 'scan', 'full-scan': 'scan', 'assess': 'scan',
      'assessment': 'scan', 'full-assessment': 'scan',

      // Findings
      'findings': 'findings', 'finding': 'findings', 'vuln': 'findings',
      'vulnerability': 'findings', 'temuan': 'findings', 'bug': 'findings',
      'add-finding': 'add-finding', 'tambah-finding': 'add-finding',

      // Reports
      'report': 'report', 'laporan': 'report',
      'prompt': 'prompt', 'ai-prompt': 'prompt',
      'export': 'export', 'download': 'export',
      'summary': 'summary', 'ringkasan': 'summary', 'risiko': 'summary', 'risk': 'summary',

      // System
      'status': 'status', 'health': 'status', 'kesehatan': 'status',
      'clear': 'clear', 'bersihkan': 'clear', 'reset': 'clear',
    };

    const command = nlMap[rawCommand] || rawCommand;

    // Extract flags from args
    const flags = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        const key = args[i].slice(2);
        flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      } else if (args[i].startsWith('-')) {
        const key = args[i].slice(1);
        flags[key] = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : true;
      } else {
        positional.push(args[i]);
      }
    }

    return { command, positional, flags, raw: input };
  }

  /**
   * Execute a parsed command.
   * @private
   */
  async _executeCommand(parsed, sessionId) {
    const { command, positional, flags } = parsed;
    const domain = positional[0];

    switch (command) {
      case 'help':
        return this._cmdHelp();

      case 'add':
        return this._cmdAdd(positional, flags);

      case 'list':
        return this._cmdList();

      case 'remove':
        return this._cmdRemove(domain);

      case 'info':
        return this._cmdInfo(domain);

      case 'recon':
        return this._cmdRecon(domain, flags);

      case 'dns':
        return this._cmdDns(domain);

      case 'headers':
        return this._cmdHeaders(domain);

      case 'ssl':
        return this._cmdSsl(domain);

      case 'whois':
        return this._cmdWhois(domain);

      case 'ports':
        return this._cmdPorts(domain, flags);

      case 'files':
        return this._cmdFiles(domain, flags);

      case 'scan':
        return this._cmdScan(domain, flags);

      case 'findings':
        return this._cmdFindings(domain, flags);

      case 'add-finding':
        return this._cmdAddFinding(positional, flags);

      case 'report':
        return this._cmdReport(domain);

      case 'prompt':
        return this._cmdPrompt(domain);

      case 'summary':
        return this._cmdSummary(domain);

      case 'export':
        return this._cmdExport();

      case 'status':
        return this._cmdStatus();

      case 'clear':
        return { type: 'text', text: '🧹 Data cleared (session only).', data: null };

      default:
        return {
          type: 'text',
          text: `🤔 Saya tidak mengerti perintah \`${command}\`.\n\nKetik \`help\` untuk melihat daftar perintah yang tersedia.`,
        };
    }
  }

  // ─── Command Handlers ────────────────────────

  _cmdHelp() {
    const ops = getAllowedOperations();
    return {
      type: 'text',
      text: `# 🛡️ RedOps Chatbot — Daftar Perintah

**Target Management:**
- \`add <domain>\` — Daftarkan target (opsional: \`--owner\` \`--scope\`)
- \`list\` — Lihat semua target terdaftar
- \`remove <domain>\` — Hapus target
- \`info <domain>\` — Detail target

**Reconnaissance:**
- \`recon <domain>\` — Full passive recon (DNS + Headers + SSL + WHOIS)
- \`dns <domain>\` — DNS resolution
- \`headers <domain>\` — HTTP header analysis
- \`ssl <domain>\` — SSL/TLS certificate check
- \`whois <domain>\` — WHOIS/RDAP lookup

**Scanning:**
- \`ports <domain>\` — TCP port scan (opsional: \`--profile full\`)
- \`files <domain>\` — Detect exposed sensitive files
- \`scan <domain>\` — Full assessment (recon + ports + files)

**Findings:**
- \`findings <domain>\` — Lihat vulnerability findings
- \`add-finding <domain> <title> --severity <level>\` — Tambah finding

**Reports:**
- \`report <domain>\` — Generate security report
- \`prompt <domain>\` — Generate AI analysis prompt
- \`summary <domain>\` — Risk summary
- \`export\` — Export semua data

**System:**
- \`status\` — System health
- \`help\` — Tampilkan bantuan ini

💡 *Saya juga mengerti bahasa Indonesia! Coba: "recon example.com" atau "cek example.com"*`,
    };
  }

  _cmdAdd(positional, flags) {
    const domain = positional[0];
    if (!domain) return { type: 'error', text: '❌ Domain required. Usage: `add <domain>`' };

    const target = this.redops.registerTarget({
      domain,
      owner: flags.owner || flags.o,
      scope: flags.scope || flags.s,
      auth_type: flags.auth,
      notes: flags.notes,
    });

    return {
      type: 'success',
      text: `✅ **Target berhasil didaftarkan!**\n\n- **Domain:** ${target.domain}\n- **Owner:** ${target.owner}\n- **Scope:** ${target.scope}\n- **Auth:** ${target.auth_type}`,
      data: target,
    };
  }

  _cmdList() {
    const targets = this.redops.getTargets();
    if (targets.length === 0) {
      return { type: 'text', text: '📋 Belum ada target terdaftar.\n\nGunakan `add <domain>` untuk mendaftarkan target.' };
    }

    const rows = targets.map((t) => {
      const summary = this.redops.getRiskSummary(t.domain);
      return `| ${t.domain} | ${t.owner} | ${summary.risk_score}/100 | ${summary.active_findings} findings |`;
    }).join('\n');

    return {
      type: 'table',
      text: `📋 **Registered Targets (${targets.length})**\n\n| Domain | Owner | Risk | Findings |\n|--------|-------|------|----------|\n${rows}`,
      data: targets,
    };
  }

  _cmdRemove(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required. Usage: `remove <domain>`' };
    this.redops.deleteTarget(domain);
    return { type: 'success', text: `🗑️ Target **${domain}** berhasil dihapus beserta semua datanya.` };
  }

  _cmdInfo(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const target = this.redops.getTarget(domain);
    const summary = this.redops.getRiskSummary(domain);

    return {
      type: 'info',
      text: `📋 **Target: ${domain}**\n\n- **Owner:** ${target.owner}\n- **Scope:** ${target.scope}\n- **Auth:** ${target.auth_type}\n- **Tech Stack:** ${target.tech_stack || 'Unknown'}\n- **IPs:** ${(target.ips || []).join(', ') || 'Not resolved'}\n- **Risk Score:** ${summary.risk_score}/100\n- **Active Findings:** ${summary.active_findings}\n- **Total Scans:** ${summary.total_scans}\n- **Last Scan:** ${summary.last_scan || 'Never'}`,
      data: { target, summary },
    };
  }

  async _cmdRecon(domain, flags) {
    if (!domain) return { type: 'error', text: '❌ Domain required. Usage: `recon <domain>`' };

    // Auto-register if not exists
    try { this.redops.getTarget(domain); } catch { this.redops.registerTarget({ domain }); }

    const scan = await this.redops.passiveRecon(domain, { timeout: parseInt(flags.timeout) || 15000 });
    let text = `🔍 **Recon Results: ${domain}**\n\n`;

    if (scan.results.dns) {
      text += `**DNS Records:**\n`;
      text += `- A: ${scan.results.dns.a.join(', ') || 'none'}\n`;
      text += `- AAAA: ${scan.results.dns.aaaa.join(', ') || 'none'}\n`;
      text += `- MX: ${scan.results.dns.mx.join(', ') || 'none'}\n`;
      text += `- NS: ${scan.results.dns.ns.join(', ') || 'none'}\n\n`;
    }

    if (scan.results.headers) {
      const h = scan.results.headers;
      text += `**HTTP Analysis:**\n`;
      text += `- Status: ${h.status}\n`;
      text += `- Response: ${h.response_time_ms}ms\n`;
      text += `- Security Score: **${h.security.score}/100**\n`;
      text += `- Technologies: ${h.technologies.join(', ') || 'none'}\n`;
      if (h.security.missing.length > 0) text += `- ⚠️ Missing: ${h.security.missing.join(', ')}\n`;
      if (h.info_leaks.length > 0) text += `- 🔴 Info Leaks: ${h.info_leaks.map(l => `${l.header}=${l.value}`).join(', ')}\n`;
      text += '\n';
    }

    if (scan.results.ssl) {
      const s = scan.results.ssl;
      text += `**SSL/TLS:**\n`;
      if (s.valid) {
        text += `- Protocol: ${s.protocol}\n`;
        text += `- Cipher: ${s.cipher}\n`;
        text += `- Expires: ${s.valid_to} (${s.days_until_expiry} days)\n`;
        if (s.self_signed) text += `- ⚠️ Self-signed!\n`;
        if (s.days_until_expiry < 30) text += `- 🔴 Expiring soon!\n`;
      } else {
        text += `- ❌ ${s.error}\n`;
      }
      text += '\n';
    }

    if (scan.results.whois) {
      const w = scan.results.whois;
      text += `**WHOIS:**\n`;
      text += `- Registrar: ${w.registrar || 'Unknown'}\n`;
      text += `- Status: ${(w.status || []).join(', ') || 'N/A'}\n`;
    }

    if (scan.errors.length > 0) {
      text += `\n⚠️ **Errors:** ${scan.errors.map(e => `[${e.module}] ${e.error}`).join(', ')}`;
    }

    return { type: 'recon', text, data: scan };
  }

  async _cmdDns(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const { resolveDns } = require('../net');
    const result = await resolveDns(domain);

    return {
      type: 'dns',
      text: `🌐 **DNS for ${domain}:**\n\n- **A:** ${result.a.join(', ') || 'none'}\n- **AAAA:** ${result.aaaa.join(', ') || 'none'}\n- **MX:** ${result.mx.join(', ') || 'none'}\n- **NS:** ${result.ns.join(', ') || 'none'}\n- **TXT:** ${(result.txt || []).slice(0, 5).join(' | ') || 'none'}\n- **CNAME:** ${result.cname.join(', ') || 'none'}`,
      data: result,
    };
  }

  async _cmdHeaders(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const { analyzeHeaders } = require('../net');
    const result = await analyzeHeaders(`https://${domain}`, { timeout: 15000 });

    const checks = Object.entries(result.security.checks)
      .map(([name, check]) => `${check.present ? '✅' : '❌'} ${name}: ${check.value || 'missing'}`)
      .join('\n');

    return {
      type: 'headers',
      text: `📊 **HTTP Headers: ${domain}**\n\n**Score: ${result.security.score}/100**\n\n${checks}\n\n**Technologies:** ${result.technologies.join(', ') || 'none'}\n${result.info_leaks.length > 0 ? `\n**Info Leaks:**\n${result.info_leaks.map(l => `- ${l.header}: ${l.value}`).join('\n')}` : ''}`,
      data: result,
    };
  }

  async _cmdSsl(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const { analyzeSsl } = require('../net');
    const result = await analyzeSsl(domain);

    if (!result.valid) {
      return { type: 'ssl', text: `🔒 **SSL: ${domain}**\n\n❌ ${result.error}`, data: result };
    }

    return {
      type: 'ssl',
      text: `🔒 **SSL/TLS: ${domain}**\n\n- **Protocol:** ${result.protocol}\n- **Cipher:** ${result.cipher}\n- **Subject:** ${result.subject?.CN || 'N/A'}\n- **Issuer:** ${result.issuer?.CN || 'N/A'}\n- **Valid:** ${result.valid_from} → ${result.valid_to}\n- **Days Left:** ${result.days_until_expiry}\n- **Chain Length:** ${result.chain_length}\n- **Self-Signed:** ${result.self_signed ? '⚠️ Yes' : 'No'}\n- **SAN:** ${result.san || 'none'}`,
      data: result,
    };
  }

  async _cmdWhois(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const { whoisRdap } = require('../net');
    const result = await whoisRdap(domain);

    const events = (result.events || []).map(e => `- ${e.action}: ${e.date}`).join('\n') || 'N/A';

    return {
      type: 'whois',
      text: `📝 **WHOIS/RDAP: ${domain}**\n\n- **Registrar:** ${result.registrar || 'Unknown'}\n- **Status:** ${(result.status || []).join(', ') || 'N/A'}\n- **Nameservers:** ${(result.nameservers || []).join(', ') || 'N/A'}\n\n**Events:**\n${events}`,
      data: result,
    };
  }

  async _cmdPorts(domain, flags) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    try { this.redops.getTarget(domain); } catch { this.redops.registerTarget({ domain }); }

    const scan = await this.redops.portScan(domain, {
      profile: flags.profile || flags.p || 'web',
      timeout: parseInt(flags.timeout) || 3000,
    });

    const r = scan.results;
    return {
      type: 'ports',
      text: `🔌 **Port Scan: ${r.host}**\n\n- **Scanned:** ${r.scanned} ports\n- **Open:** ${r.open.length > 0 ? r.open.join(', ') : 'none'} ${r.open.length > 0 ? '🔴' : '🟢'}\n- **Filtered:** ${r.filtered.length > 0 ? r.filtered.join(', ') : 'none'}\n- **Closed:** ${r.closed.length}`,
      data: scan,
    };
  }

  async _cmdFiles(domain, flags) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    try { this.redops.getTarget(domain); } catch { this.redops.registerTarget({ domain }); }

    const scan = await this.redops.detectFiles(domain, { timeout: parseInt(flags.timeout) || 5000 });
    const r = scan.results;

    if (r.found.length === 0) {
      return { type: 'files', text: `📁 **File Detection: ${domain}**\n\n✅ No sensitive files found. Checked ${r.checked} paths.`, data: scan };
    }

    const found = r.found.map(f => `- \`${f.path}\` → ${f.status} (${f.content_type || 'unknown'})`).join('\n');
    return {
      type: 'files',
      text: `📁 **File Detection: ${domain}**\n\n🔴 **${r.found.length} exposed files found** (checked ${r.checked} paths):\n\n${found}`,
      data: scan,
    };
  }

  async _cmdScan(domain, flags) {
    if (!domain) return { type: 'error', text: '❌ Domain required. Usage: `scan <domain>`' };
    try { this.redops.getTarget(domain); } catch { this.redops.registerTarget({ domain }); }

    const result = await this.redops.fullAssessment(domain, {
      port_profile: flags.full ? 'full' : 'web',
      timeout: parseInt(flags.timeout) || 10000,
    });

    const summary = this.redops.getRiskSummary(domain);
    const findings = this.redops.getFindings(domain);

    let text = `🛡️ **Full Assessment Complete: ${domain}**\n`;
    text += `⏱️ Duration: ${result.duration_seconds}s\n\n`;
    text += `**Risk Score: ${summary.risk_score}/100**\n\n`;

    if (summary.by_severity.critical > 0 || summary.by_severity.high > 0) {
      text += `🔴 **${summary.by_severity.critical} Critical** | **${summary.by_severity.high} High** | ${summary.by_severity.medium} Medium | ${summary.by_severity.low} Low\n\n`;
    }

    if (findings.length > 0) {
      text += `**Findings (${findings.length}):**\n`;
      findings.slice(0, 10).forEach(f => {
        const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' }[f.severity] || '⚪';
        text += `${icon} [${f.severity.toUpperCase()}] ${f.title}\n`;
      });
    }

    return { type: 'scan', text, data: result };
  }

  _cmdFindings(domain, flags) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const findings = this.redops.getFindings(domain, {
      severity: flags.severity,
      status: flags.status,
    });

    if (findings.length === 0) {
      return { type: 'text', text: `✅ No findings for **${domain}**.`, data: [] };
    }

    const items = findings.map(f => {
      const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' }[f.severity] || '⚪';
      let line = `${icon} **[${f.severity.toUpperCase()}]** ${f.title}\n`;
      line += `   ID: \`${f.id}\` | Status: ${f.status}`;
      if (f.cvss) line += ` | CVSS: ${f.cvss}`;
      if (f.affected_url) line += `\n   URL: ${f.affected_url}`;
      if (f.remediation) line += `\n   Fix: ${f.remediation}`;
      return line;
    }).join('\n\n');

    return {
      type: 'findings',
      text: `🐛 **Findings: ${domain} (${findings.length})**\n\n${items}`,
      data: findings,
    };
  }

  _cmdAddFinding(positional, flags) {
    const domain = positional[0];
    const title = positional.slice(1).join(' ') || flags.title;
    if (!domain || !title) return { type: 'error', text: '❌ Usage: `add-finding <domain> <title> --severity <level>`' };

    const finding = this.redops.addFinding(domain, {
      title,
      severity: flags.severity || 'medium',
      cvss: flags.cvss ? parseFloat(flags.cvss) : null,
      owasp: flags.owasp,
      description: flags.description,
      remediation: flags.fix || flags.remediation,
      affected_url: flags.url,
    });

    return {
      type: 'success',
      text: `✅ **Finding added!**\n\n- **ID:** \`${finding.id}\`\n- **Title:** ${finding.title}\n- **Severity:** ${finding.severity}`,
      data: finding,
    };
  }

  _cmdReport(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const report = this.redops.generateReport(domain);
    const r = report.report;

    let text = `📊 **Security Report: ${domain}**\n\n`;
    text += `**Score: ${r.score.current}/100 (Grade: ${r.score.grade})**\n`;
    text += `Target: ${r.score.target}/100 | Gap: ${r.score.gap}\n\n`;

    text += `**Risk Dashboard:**\n`;
    Object.entries(r.dashboard).forEach(([cat, data]) => {
      text += `- ${cat}: ${data.count} findings (${data.highest_severity})\n`;
    });

    if (r.roadmap.immediate.length > 0) {
      text += `\n🔴 **IMMEDIATE (24h):**\n${r.roadmap.immediate.map(f => `- ${f.finding}`).join('\n')}`;
    }
    if (r.roadmap.short_term.length > 0) {
      text += `\n\n🟠 **SHORT-TERM (1 week):**\n${r.roadmap.short_term.map(f => `- ${f.finding}`).join('\n')}`;
    }

    return { type: 'report', text, data: report };
  }

  _cmdPrompt(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const prompt = this.redops.generatePrompt(domain);
    return {
      type: 'prompt',
      text: `📋 **AI Analysis Prompt for ${domain}** (${prompt.length} chars)\n\n\`\`\`\n${prompt.substring(0, 1000)}...\n\`\`\`\n\n*Full prompt available via export.*`,
      data: { prompt_length: prompt.length, prompt },
    };
  }

  _cmdSummary(domain) {
    if (!domain) return { type: 'error', text: '❌ Domain required.' };
    const summary = this.redops.getRiskSummary(domain);

    return {
      type: 'summary',
      text: `📈 **Risk Summary: ${domain}**\n\n- **Risk Score:** ${summary.risk_score}/100\n- **Active Findings:** ${summary.active_findings}/${summary.total_findings}\n- **Critical:** ${summary.by_severity.critical}\n- **High:** ${summary.by_severity.high}\n- **Medium:** ${summary.by_severity.medium}\n- **Low:** ${summary.by_severity.low}\n- **Total Scans:** ${summary.total_scans}\n- **Header Score:** ${summary.header_score ?? 'N/A'}`,
      data: summary,
    };
  }

  _cmdExport() {
    const data = this.redops.exportAll();
    return {
      type: 'export',
      text: `💾 **Data Exported**\n\n- Targets: ${data.targets?.length || 0}\n- Findings: ${data.findings?.length || 0}\n- Scans: ${data.scans?.length || 0}`,
      data,
    };
  }

  _cmdStatus() {
    const targets = this.redops.getTargets();
    const allFindings = [];
    targets.forEach(t => {
      const findings = this.redops.getFindings(t.domain);
      allFindings.push(...findings);
    });

    return {
      type: 'status',
      text: `🟢 **RedOps System Status**\n\n- **Version:** 2.0.0\n- **Targets:** ${targets.length}\n- **Total Findings:** ${allFindings.length}\n- **Safety Guard:** Active (${require('./guard').BLOCKED_PATTERNS_COUNT} blocked patterns)\n- **Uptime:** ${Math.floor(process.uptime())}s\n- **Memory:** ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    };
  }
}

module.exports = { Chatbot };
