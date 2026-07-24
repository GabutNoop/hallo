'use strict';

/**
 * VPS model — represents infrastructure/VPS node data.
 */
class VPS {
  /**
   * @param {Object} opts
   * @param {string} opts.hostname
   * @param {string} opts.ip
   * @param {string} [opts.os]
   * @param {number[]} [opts.open_ports]
   * @param {number} [opts.hardening_score]
   * @param {string} [opts.status]
   * @param {number} [opts.threats_blocked]
   * @param {Object} [opts.services]
   * @param {Object} [opts.metadata]
   */
  constructor(opts = {}) {
    if (!opts.hostname && !opts.ip) {
      throw new Error('VPS hostname or IP is required');
    }

    this.hostname = opts.hostname || 'unknown';
    this.ip = opts.ip || '0.0.0.0';
    this.os = opts.os || 'Unknown';
    this.open_ports = opts.open_ports || [];
    this.hardening_score = opts.hardening_score ?? 0;
    this.status = opts.status || 'unknown';
    this.threats_blocked = opts.threats_blocked || 0;
    this.services = opts.services || {};
    this.metadata = opts.metadata || {};
    this.created_at = new Date().toISOString();
  }

  /**
   * Identify potentially risky open ports.
   * @returns {{ port: number, risk: string }[]}
   */
  getRiskyPorts() {
    const riskyPortMap = {
      21: 'FTP — cleartext credentials',
      23: 'Telnet — unencrypted remote access',
      25: 'SMTP — potential open relay',
      110: 'POP3 — cleartext email',
      135: 'MS RPC — commonly exploited',
      139: 'NetBIOS — SMB exposure',
      445: 'SMB — WannaCry/EternalBlue vector',
      1433: 'MSSQL — database exposure',
      1521: 'Oracle DB — database exposure',
      2049: 'NFS — file share exposure',
      2375: 'Docker — unencrypted daemon',
      2376: 'Docker — TLS daemon (check certs)',
      3306: 'MySQL — database exposure',
      3389: 'RDP — remote desktop',
      5432: 'PostgreSQL — database exposure',
      5900: 'VNC — remote desktop',
      6379: 'Redis — in-memory store (often no auth)',
      8080: 'HTTP Alt — admin panel candidate',
      8443: 'HTTPS Alt — admin panel candidate',
      9200: 'Elasticsearch — often no auth',
      27017: 'MongoDB — often no auth',
    };

    return this.open_ports
      .filter((p) => riskyPortMap[p])
      .map((p) => ({ port: p, risk: riskyPortMap[p] }));
  }

  /**
   * Quick health assessment.
   * @returns {{ grade: string, issues: string[] }}
   */
  assess() {
    const issues = [];
    const riskyPorts = this.getRiskyPorts();

    if (riskyPorts.length > 0) {
      issues.push(`${riskyPorts.length} risky port(s) open: ${riskyPorts.map((r) => r.port).join(', ')}`);
    }

    if (this.hardening_score < 50) {
      issues.push(`Hardening score critically low (${this.hardening_score}/100)`);
    } else if (this.hardening_score < 75) {
      issues.push(`Hardening score below target (${this.hardening_score}/100, target: 85)`);
    }

    if (this.open_ports.length > 10) {
      issues.push(`Excessive open ports (${this.open_ports.length}) — attack surface too large`);
    }

    let grade;
    if (this.hardening_score >= 85) grade = 'A';
    else if (this.hardening_score >= 70) grade = 'B';
    else if (this.hardening_score >= 50) grade = 'C';
    else if (this.hardening_score >= 30) grade = 'D';
    else grade = 'F';

    return { grade, issues };
  }

  toJSON() {
    return {
      hostname: this.hostname,
      ip: this.ip,
      os: this.os,
      open_ports: this.open_ports,
      hardening_score: this.hardening_score,
      status: this.status,
      threats_blocked: this.threats_blocked,
      services: this.services,
      metadata: this.metadata,
      created_at: this.created_at,
    };
  }
}

module.exports = { VPS };
