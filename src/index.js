'use strict';

const { resolveDns, scanPorts, analyzeSsl, analyzeHeaders, detectExposedFiles, whoisRdap, RateLimiter, COMMON_PORTS, WEB_PORTS } = require('./net');
const { Storage } = require('./storage');
const { buildMasterSecurityPrompt } = require('./prompts/masterSecurityPrompt');
const { ReportGenerator } = require('./report');
const { Logger } = require('./utils/logger');
const path = require('path');

/**
 * RedOps v2.0 — Real Security Analysis Engine
 *
 * Performs actual network reconnaissance on authorized targets.
 */
class RedOps {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.dataDir] - Data storage directory
   * @param {boolean} [opts.verbose] - Enable verbose logging
   * @param {number} [opts.maxPerSecond] - Rate limit per second
   * @param {number} [opts.maxPerMinute] - Rate limit per minute
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.join(process.cwd(), 'data');
    this.storage = new Storage(this.dataDir);
    this.logger = new Logger('RedOps', opts.verbose ? 0 : 1);
    this.limiter = new RateLimiter({
      maxPerSecond: opts.maxPerSecond || 5,
      maxPerMinute: opts.maxPerMinute || 60,
    });
  }

  // ─────────────────────────────────────────────
  // Target Management
  // ─────────────────────────────────────────────

  /**
   * Register an authorized target.
   * @param {Object} targetData
   * @returns {Object}
   */
  registerTarget(targetData) {
    if (!targetData.domain) {
      throw new Error('Domain is required');
    }

    // Check for duplicate
    const existing = this.storage.findOne('targets', (t) => t.domain === targetData.domain);
    if (existing) {
      this.logger.warn(`Target already registered: ${targetData.domain}, updating...`);
      this.storage.update('targets', (t) => t.domain === targetData.domain, {
        ...targetData,
        updated_at: new Date().toISOString(),
      });
      return { ...existing, ...targetData };
    }

    const target = {
      domain: targetData.domain,
      owner: targetData.owner || 'Self-Owned',
      scope: targetData.scope || 'Full Assessment',
      auth_type: targetData.auth_type || 'Self-Assessment',
      operator: targetData.operator || 'Admin',
      tech_stack: targetData.tech_stack || null,
      risk_score: targetData.risk_score || null,
      ips: targetData.ips || [],
      notes: targetData.notes || '',
      created_at: new Date().toISOString(),
    };

    this.storage.insert('targets', target);
    this.logger.info(`Target registered: ${target.domain}`);
    return target;
  }

  /**
   * Get all registered targets.
   * @returns {Object[]}
   */
  getTargets() {
    return this.storage.load('targets');
  }

  /**
   * Get a specific target.
   * @param {string} domain
   * @returns {Object}
   */
  getTarget(domain) {
    const target = this.storage.findOne('targets', (t) => t.domain === domain);
    if (!target) throw new Error(`Target not found: ${domain}`);
    return target;
  }

  /**
   * Delete a target and all associated data.
   * @param {string} domain
   */
  deleteTarget(domain) {
    this.storage.delete('targets', (t) => t.domain === domain);
    this.storage.delete('findings', (f) => f.target === domain);
    this.storage.delete('scans', (s) => s.target === domain);
    this.logger.info(`Target deleted: ${domain}`);
  }

  // ─────────────────────────────────────────────
  // Real Reconnaissance
  // ─────────────────────────────────────────────

  /**
   * Run full passive recon on a target.
   * @param {string} domain
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  async passiveRecon(domain, opts = {}) {
    this.getTarget(domain); // Verify target exists
    this.logger.info(`Starting passive recon for ${domain}...`);

    const scan = {
      id: `SCAN-${Date.now().toString(36)}`,
      type: 'passive_recon',
      target: domain,
      status: 'running',
      started_at: new Date().toISOString(),
      results: {},
      errors: [],
    };

    // DNS Resolution
    this.logger.info(`  → Resolving DNS...`);
    try {
      await this.limiter.acquire();
      scan.results.dns = await resolveDns(domain);
      this.logger.info(`  ✓ DNS: ${scan.results.dns.a.length} A records, ${scan.results.dns.mx.length} MX records`);
    } catch (err) {
      scan.errors.push({ module: 'dns', error: err.message });
      this.logger.error(`  ✗ DNS failed: ${err.message}`);
    }

    // WHOIS/RDAP
    this.logger.info(`  → Querying RDAP...`);
    try {
      await this.limiter.acquire();
      scan.results.whois = await whoisRdap(domain);
      this.logger.info(`  ✓ WHOIS: ${scan.results.whois.registrar || 'unknown registrar'}`);
    } catch (err) {
      scan.errors.push({ module: 'whois', error: err.message });
      this.logger.error(`  ✗ WHOIS failed: ${err.message}`);
    }

    // HTTP Header Analysis
    this.logger.info(`  → Analyzing HTTP headers...`);
    try {
      await this.limiter.acquire();
      const url = `https://${domain}`;
      scan.results.headers = await analyzeHeaders(url, { timeout: opts.timeout || 10000 });
      this.logger.info(`  ✓ Headers: score ${scan.results.headers.security.score}/100, ${scan.results.headers.technologies.length} techs detected`);
    } catch (err) {
      // Try HTTP if HTTPS fails
      try {
        const url = `http://${domain}`;
        scan.results.headers = await analyzeHeaders(url, { timeout: opts.timeout || 10000 });
        this.logger.info(`  ✓ Headers (HTTP fallback): score ${scan.results.headers.security.score}/100`);
      } catch (err2) {
        scan.errors.push({ module: 'headers', error: err2.message });
        this.logger.error(`  ✗ Headers failed: ${err2.message}`);
      }
    }

    // SSL Certificate
    this.logger.info(`  → Analyzing SSL/TLS...`);
    try {
      scan.results.ssl = await analyzeSsl(domain);
      if (scan.results.ssl.valid) {
        this.logger.info(`  ✓ SSL: ${scan.results.ssl.protocol}, expires in ${scan.results.ssl.days_until_expiry} days`);
      } else {
        this.logger.warn(`  ✗ SSL: ${scan.results.ssl.error}`);
      }
    } catch (err) {
      scan.errors.push({ module: 'ssl', error: err.message });
      this.logger.error(`  ✗ SSL failed: ${err.message}`);
    }

    scan.status = scan.errors.length === 0 ? 'completed' : 'completed_with_errors';
    scan.completed_at = new Date().toISOString();

    // Update target with discovered info
    const updates = { last_scan: scan.completed_at };
    if (scan.results.dns?.a?.length > 0) {
      updates.ips = scan.results.dns.a;
    }
    if (scan.results.headers?.technologies?.length > 0) {
      updates.tech_stack = scan.results.headers.technologies.join(', ');
    }
    this.storage.update('targets', (t) => t.domain === domain, updates);

    // Save scan record
    this.storage.insert('scans', scan);
    this.logger.info(`Recon complete: ${scan.status}`);

    return scan;
  }

  /**
   * Run port scan on a target (ACTIVE — requires explicit opt-in).
   * @param {string} domain
   * @param {Object} [opts]
   * @param {number[]} [opts.ports] - Custom port list
   * @param {string} [opts.profile] - 'web' or 'full'
   * @returns {Promise<Object>}
   */
  async portScan(domain, opts = {}) {
    const target = this.getTarget(domain);
    const host = target.ips?.[0] || domain;

    let ports;
    if (opts.ports) {
      ports = opts.ports;
    } else if (opts.profile === 'full') {
      ports = COMMON_PORTS;
    } else {
      ports = WEB_PORTS;
    }

    this.logger.info(`Port scanning ${host} (${ports.length} ports)...`);

    const result = await scanPorts(host, ports, {
      timeout: opts.timeout || 3000,
      concurrency: opts.concurrency || 10,
    });

    const scan = {
      id: `SCAN-${Date.now().toString(36)}`,
      type: 'port_scan',
      target: domain,
      host,
      status: 'completed',
      results: result,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    this.storage.insert('scans', scan);
    this.logger.info(`Port scan complete: ${result.open.length} open, ${result.filtered.length} filtered`);

    return scan;
  }

  /**
   * Detect exposed sensitive files.
   * @param {string} domain
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  async detectFiles(domain, opts = {}) {
    this.getTarget(domain);

    const baseUrl = opts.protocol ? `${opts.protocol}://${domain}` : `https://${domain}`;
    this.logger.info(`Scanning for exposed files at ${baseUrl}...`);

    const result = await detectExposedFiles(baseUrl, {
      timeout: opts.timeout || 5000,
      concurrency: opts.concurrency || 5,
    });

    const scan = {
      id: `SCAN-${Date.now().toString(36)}`,
      type: 'file_detection',
      target: domain,
      status: 'completed',
      results: result,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    this.storage.insert('scans', scan);
    this.logger.info(`File detection: ${result.found.length} files found out of ${result.checked}`);

    // Auto-generate findings for critical exposed files
    const criticalFiles = ['.env', '.git/config', '.git/HEAD', 'wp-config.php', 'backup.sql', 'dump.sql'];
    result.found.forEach((f) => {
      if (criticalFiles.some((cf) => f.path.includes(cf))) {
        this.addFinding(domain, {
          title: `Sensitive file exposed: ${f.path}`,
          severity: f.path.includes('.env') || f.path.includes('config') ? 'critical' : 'high',
          description: `The file ${f.path} is publicly accessible at ${f.url}`,
          affected_url: f.url,
          source: 'auto_detect',
          remediation: `Restrict access to ${f.path} via web server configuration`,
        });
      }
    });

    return scan;
  }

  /**
   * Run full assessment (passive recon + port scan + file detection).
   * @param {string} domain
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  async fullAssessment(domain, opts = {}) {
    this.logger.info(`═══ Starting full assessment for ${domain} ═══`);
    const startedAt = Date.now();

    // Phase 1: Passive recon
    const recon = await this.passiveRecon(domain, opts);

    // Phase 2: Port scan (web ports by default)
    let portResults = null;
    if (opts.include_ports !== false) {
      portResults = await this.portScan(domain, {
        profile: opts.port_profile || 'web',
        ...opts,
      });
    }

    // Phase 3: File detection
    let fileResults = null;
    if (opts.include_files !== false) {
      fileResults = await this.detectFiles(domain, opts);
    }

    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    this.logger.info(`═══ Assessment complete for ${domain} (${duration}s) ═══`);

    return {
      domain,
      duration_seconds: parseFloat(duration),
      recon,
      ports: portResults,
      files: fileResults,
      findings: this.getFindings(domain),
      timestamp: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────
  // Findings Management
  // ─────────────────────────────────────────────

  /**
   * Add a vulnerability finding.
   * @param {string} domain
   * @param {Object} findingData
   * @returns {Object}
   */
  addFinding(domain, findingData) {
    this.getTarget(domain); // Verify target exists

    const finding = {
      id: `FIND-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      target: domain,
      title: findingData.title,
      severity: findingData.severity || 'info',
      cvss: findingData.cvss || null,
      owasp: findingData.owasp || null,
      mitre: findingData.mitre || null,
      status: findingData.status || 'open',
      proof: findingData.proof || null,
      description: findingData.description || null,
      affected_url: findingData.affected_url || null,
      remediation: findingData.remediation || null,
      source: findingData.source || 'manual',
      metadata: findingData.metadata || {},
      created_at: new Date().toISOString(),
    };

    this.storage.insert('findings', finding);
    this.logger.info(`Finding: [${finding.severity.toUpperCase()}] ${finding.title}`);
    return finding;
  }

  /**
   * Get findings for a target.
   * @param {string} domain
   * @param {Object} [opts]
   * @returns {Object[]}
   */
  getFindings(domain, opts = {}) {
    let findings = this.storage.find('findings', (f) => f.target === domain);

    if (opts.severity) {
      findings = findings.filter((f) => f.severity === opts.severity);
    }
    if (opts.status) {
      findings = findings.filter((f) => f.status === opts.status);
    }

    // Sort by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...findings].sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));
  }

  /**
   * Update a finding's status.
   * @param {string} findingId
   * @param {string} status
   * @param {string} [reason]
   */
  updateFindingStatus(findingId, status, reason) {
    const count = this.storage.update(
      'findings',
      (f) => f.id === findingId,
      {
        status,
        status_reason: reason,
        status_history: [
          ...(this.storage.findOne('findings', (f) => f.id === findingId)?.metadata?.status_history || []),
          { to: status, reason, timestamp: new Date().toISOString() },
        ],
      }
    );

    if (count === 0) throw new Error(`Finding not found: ${findingId}`);
  }

  // ─────────────────────────────────────────────
  // Reports & Prompts
  // ─────────────────────────────────────────────

  /**
   * Generate risk summary for a target.
   * @param {string} domain
   * @returns {Object}
   */
  getRiskSummary(domain) {
    const findings = this.getFindings(domain);
    const scans = this.storage.find('scans', (s) => s.target === domain);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => {
      if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++;
    });

    const active = findings.filter((f) => f.status === 'open' || f.status === 'confirmed');

    let riskScore = 100;
    riskScore -= active.filter((f) => f.severity === 'critical').length * 25;
    riskScore -= active.filter((f) => f.severity === 'high').length * 15;
    riskScore -= active.filter((f) => f.severity === 'medium').length * 8;
    riskScore -= active.filter((f) => f.severity === 'low').length * 3;
    riskScore = Math.max(0, Math.min(100, riskScore));

    const lastScan = scans.length > 0 ? scans[scans.length - 1] : null;
    const headerScore = lastScan?.results?.headers?.security?.score || null;

    return {
      domain,
      risk_score: riskScore,
      total_findings: findings.length,
      active_findings: active.length,
      by_severity: bySeverity,
      total_scans: scans.length,
      last_scan: lastScan?.completed_at || null,
      header_score: headerScore,
    };
  }

  /**
   * Generate the master security analysis prompt.
   * @param {string} domain
   * @returns {string}
   */
  generatePrompt(domain) {
    const target = this.getTarget(domain);
    const findings = this.getFindings(domain);
    const scans = this.storage.find('scans', (s) => s.target === domain);
    const lastScan = scans.length > 0 ? scans[scans.length - 1] : null;

    // Build scan data for prompt
    const scanData = lastScan
      ? {
          type: lastScan.type,
          logs: this._scanToLogs(lastScan),
        }
      : null;

    return buildMasterSecurityPrompt(target, scanData, findings, null);
  }

  /**
   * Generate a full security report.
   * @param {string} domain
   * @returns {Object}
   */
  generateReport(domain) {
    const target = this.getTarget(domain);
    const findings = this.getFindings(domain);
    const scans = this.storage.find('scans', (s) => s.target === domain);
    const lastScan = scans.length > 0 ? scans[scans.length - 1] : null;
    const headerScore = lastScan?.results?.headers?.security?.score || 50;

    return {
      target,
      report: ReportGenerator.generateFullReport({
        domain,
        findings,
        headerScore,
      }),
      summary: this.getRiskSummary(domain),
      scans: scans.map((s) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        completed_at: s.completed_at,
      })),
    };
  }

  /**
   * Convert scan results to log format for prompt.
   * @private
   */
  _scanToLogs(scan) {
    const logs = [];

    if (scan.results?.dns) {
      logs.push(`DNS A records: ${scan.results.dns.a.join(', ') || 'none'}`);
      logs.push(`DNS MX: ${scan.results.dns.mx.join(', ') || 'none'}`);
      logs.push(`DNS NS: ${scan.results.dns.ns.join(', ') || 'none'}`);
    }

    if (scan.results?.headers) {
      logs.push(`HTTP Status: ${scan.results.headers.status}`);
      logs.push(`Security headers score: ${scan.results.headers.security.score}/100`);
      logs.push(`Missing headers: ${scan.results.headers.security.missing.join(', ')}`);
      logs.push(`Technologies: ${scan.results.headers.technologies.join(', ') || 'none detected'}`);
      if (scan.results.headers.info_leaks.length > 0) {
        logs.push(`Info leakage: ${scan.results.headers.info_leaks.map((l) => `${l.header}=${l.value}`).join(', ')}`);
      }
    }

    if (scan.results?.ssl) {
      if (scan.results.ssl.valid) {
        logs.push(`SSL: ${scan.results.ssl.protocol}, ${scan.results.ssl.cipher}`);
        logs.push(`SSL expires: ${scan.results.ssl.valid_to} (${scan.results.ssl.days_until_expiry} days)`);
        if (scan.results.ssl.self_signed) logs.push(`WARNING: Self-signed certificate`);
      } else {
        logs.push(`SSL: INVALID — ${scan.results.ssl.error}`);
      }
    }

    if (scan.results?.open) {
      logs.push(`Open ports: ${scan.results.open.join(', ') || 'none'}`);
      logs.push(`Filtered ports: ${scan.results.filtered.join(', ') || 'none'}`);
    }

    if (scan.results?.found) {
      logs.push(`Exposed files: ${scan.results.found.map((f) => `${f.path} (${f.status})`).join(', ')}`);
    }

    return logs;
  }

  // ─────────────────────────────────────────────
  // Export / Import
  // ─────────────────────────────────────────────

  /**
   * Export all data as JSON.
   * @returns {Object}
   */
  exportAll() {
    return {
      version: '2.0.0',
      ...this.storage.exportAll(),
      exported_at: new Date().toISOString(),
    };
  }
}

module.exports = { RedOps };
