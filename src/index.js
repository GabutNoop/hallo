'use strict';

const { buildMasterSecurityPrompt } = require('./prompts/masterSecurityPrompt');
const { Target, Finding, VPS } = require('./models');
const { Logger } = require('./utils/logger');

/**
 * RedOps — Security Analysis Orchestrator
 *
 * Coordinates target registration, scanning, findings, and report generation.
 */
class RedOps {
  constructor() {
    this.logger = new Logger('RedOps');
    this.targets = new Map();
    this.findings = new Map();
    this.vpsNodes = new Map();
    this.scanHistory = [];
  }

  /**
   * Register a new authorized target.
   * @param {Object} targetOpts
   * @returns {Target}
   */
  registerTarget(targetOpts) {
    const target = new Target(targetOpts);
    const validation = target.validate();

    if (!validation.valid) {
      throw new Error(`Target validation failed: ${validation.errors.join(', ')}`);
    }

    this.targets.set(target.domain, target);
    this.logger.info(`Target registered: ${target.domain}`);
    return target;
  }

  /**
   * Add a vulnerability finding for a target.
   * @param {string} domain
   * @param {Object} findingOpts
   * @returns {Finding}
   */
  addFinding(domain, findingOpts) {
    if (!this.targets.has(domain)) {
      throw new Error(`Target not registered: ${domain}`);
    }

    const finding = new Finding(findingOpts);
    this.findings.set(finding.id, { ...finding.toJSON(), target: domain });
    this.logger.info(`Finding added: [${finding.severity.toUpperCase()}] ${finding.title}`);
    return finding;
  }

  /**
   * Register a VPS node.
   * @param {Object} vpsOpts
   * @returns {VPS}
   */
  registerVPS(vpsOpts) {
    const vps = new VPS(vpsOpts);
    this.vpsNodes.set(vps.hostname, vps);
    this.logger.info(`VPS registered: ${vps.hostname} (${vps.ip})`);
    return vps;
  }

  /**
   * Record scan data for a target.
   * @param {string} domain
   * @param {Object} scanData
   */
  recordScan(domain, scanData) {
    if (!this.targets.has(domain)) {
      throw new Error(`Target not registered: ${domain}`);
    }

    const scan = {
      ...scanData,
      target: domain,
      timestamp: new Date().toISOString(),
    };

    this.scanHistory.push(scan);
    this.targets.get(domain).last_scan = scan.timestamp;
    this.logger.info(`Scan recorded for ${domain}: ${scanData.type || 'unknown'}`);
    return scan;
  }

  /**
   * Get all findings for a target, sorted by priority.
   * @param {string} domain
   * @returns {Object[]}
   */
  getFindings(domain) {
    return Array.from(this.findings.values())
      .filter((f) => f.target === domain)
      .map((f) => new Finding(f))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .map((f) => f.toJSON());
  }

  /**
   * Generate the master security analysis prompt for a target.
   * @param {string} domain
   * @returns {string}
   */
  generatePrompt(domain) {
    const target = this.targets.get(domain);
    if (!target) {
      throw new Error(`Target not registered: ${domain}`);
    }

    const scanData = this.scanHistory.filter((s) => s.target === domain).pop() || null;
    const findings = this.getFindings(domain);

    // Get first VPS node if any
    const vpsData = this.vpsNodes.size > 0 ? this.vpsNodes.values().next().value.toJSON() : null;

    return buildMasterSecurityPrompt(target.toJSON(), scanData, findings, vpsData);
  }

  /**
   * Generate a risk summary for a target.
   * @param {string} domain
   * @returns {Object}
   */
  getRiskSummary(domain) {
    const findings = this.getFindings(domain);
    const vpsNodes = Array.from(this.vpsNodes.values());

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => {
      if (bySeverity[f.severity] !== undefined) {
        bySeverity[f.severity]++;
      }
    });

    const activeFindings = findings.filter(
      (f) => f.status === 'open' || f.status === 'confirmed'
    );

    let riskScore = 100;
    riskScore -= activeFindings.filter((f) => f.severity === 'critical').length * 25;
    riskScore -= activeFindings.filter((f) => f.severity === 'high').length * 15;
    riskScore -= activeFindings.filter((f) => f.severity === 'medium').length * 8;
    riskScore -= activeFindings.filter((f) => f.severity === 'low').length * 3;
    riskScore = Math.max(0, Math.min(100, riskScore));

    return {
      domain,
      total_findings: findings.length,
      active_findings: activeFindings.length,
      by_severity: bySeverity,
      risk_score: riskScore,
      vps_nodes: vpsNodes.map((v) => ({
        hostname: v.hostname,
        grade: v.assess().grade,
        risky_ports: v.getRiskyPorts().length,
      })),
    };
  }

  /**
   * Export all data as JSON.
   * @returns {Object}
   */
  export() {
    return {
      targets: Array.from(this.targets.values()).map((t) => t.toJSON()),
      findings: Array.from(this.findings.values()),
      vps_nodes: Array.from(this.vpsNodes.values()).map((v) => v.toJSON()),
      scan_history: this.scanHistory,
      exported_at: new Date().toISOString(),
    };
  }
}

module.exports = { RedOps };
