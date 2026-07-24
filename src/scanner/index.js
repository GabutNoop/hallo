'use strict';

const { Logger } = require('../utils/logger');

/**
 * Scanner module — orchestrates security scanning phases.
 * All active scans require HITL (Human-In-The-Loop) approval.
 */
class Scanner {
  constructor() {
    this.logger = new Logger('Scanner');
    this.scans = [];
    this.hitlQueue = [];
  }

  /**
   * Start a passive recon scan (no HITL required).
   * @param {string} domain
   * @param {Object} [opts]
   * @returns {Object} Scan result
   */
  async passiveRecon(domain, opts = {}) {
    this.logger.info(`Starting passive recon for ${domain}`);

    const scan = {
      id: `SCAN-${Date.now().toString(36)}`,
      type: 'passive_recon',
      domain,
      status: 'running',
      started_at: new Date().toISOString(),
      logs: [],
      results: {},
    };

    try {
      const recon = require('../recon');
      const targetUrl = `https://${domain}`;

      scan.logs.push(`[${new Date().toISOString()}] Fetching headers from ${targetUrl}`);

      const headerData = await recon.fetchHeaders(targetUrl, opts);
      scan.logs.push(`[${new Date().toISOString()}] Response: ${headerData.status}`);

      const securityAnalysis = recon.analyzeSecurityHeaders(headerData.headers);
      scan.logs.push(
        `[${new Date().toISOString()}] Security headers score: ${securityAnalysis.score}/100`
      );

      const techFingerprint = recon.fingerprintTech(headerData.headers);
      scan.logs.push(
        `[${new Date().toISOString()}] Technologies detected: ${techFingerprint.technologies.length}`
      );

      scan.results = {
        headers: headerData,
        security_headers: securityAnalysis,
        tech_fingerprint: techFingerprint,
      };

      scan.status = 'completed';
      scan.completed_at = new Date().toISOString();
    } catch (err) {
      scan.status = 'error';
      scan.error = err.message;
      scan.logs.push(`[${new Date().toISOString()}] ERROR: ${err.message}`);
      this.logger.error(`Recon failed for ${domain}: ${err.message}`);
    }

    this.scans.push(scan);
    return scan;
  }

  /**
   * Request an active scan (requires HITL approval).
   * @param {string} domain
   * @param {string} scanType
   * @param {Object} [params]
   * @returns {Object} HITL request
   */
  requestActiveScan(domain, scanType, params = {}) {
    const request = {
      id: `HITL-${Date.now().toString(36)}`,
      type: 'active_scan',
      domain,
      scan_type: scanType,
      params,
      status: 'pending',
      requested_at: new Date().toISOString(),
      reason: params.reason || 'Active security assessment',
    };

    this.hitlQueue.push(request);
    this.logger.warn(
      `[HITL REQUIRED] Active scan requested: ${scanType} on ${domain} — awaiting approval`
    );

    return request;
  }

  /**
   * Approve a HITL request.
   * @param {string} requestId
   * @param {string} [approver]
   * @returns {Object} Updated request
   */
  approveHitl(requestId, approver = 'Admin') {
    const request = this.hitlQueue.find((r) => r.id === requestId);
    if (!request) {
      throw new Error(`HITL request not found: ${requestId}`);
    }

    request.status = 'approved';
    request.approved_by = approver;
    request.approved_at = new Date().toISOString();
    this.logger.info(`HITL approved: ${requestId} by ${approver}`);
    return request;
  }

  /**
   * Deny a HITL request.
   * @param {string} requestId
   * @param {string} [reason]
   * @returns {Object} Updated request
   */
  denyHitl(requestId, reason = 'Not authorized') {
    const request = this.hitlQueue.find((r) => r.id === requestId);
    if (!request) {
      throw new Error(`HITL request not found: ${requestId}`);
    }

    request.status = 'denied';
    request.deny_reason = reason;
    request.denied_at = new Date().toISOString();
    this.logger.warn(`HITL denied: ${requestId} — ${reason}`);
    return request;
  }

  /**
   * Get scan history.
   * @param {string} [domain] - Filter by domain
   * @returns {Object[]}
   */
  getScanHistory(domain) {
    if (domain) {
      return this.scans.filter((s) => s.domain === domain);
    }
    return [...this.scans];
  }

  /**
   * Get pending HITL requests.
   * @returns {Object[]}
   */
  getPendingHitl() {
    return this.hitlQueue.filter((r) => r.status === 'pending');
  }
}

module.exports = { Scanner };
