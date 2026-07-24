'use strict';

/**
 * Severity levels for security findings.
 */
const Severity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

/**
 * Finding status workflow.
 */
const FindingStatus = {
  OPEN: 'open',
  CONFIRMED: 'confirmed',
  FALSE_POSITIVE: 'false_positive',
  REMEDIATED: 'remediated',
  ACCEPTED_RISK: 'accepted_risk',
};

/**
 * Finding model — represents a single vulnerability finding.
 */
class Finding {
  /**
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} [opts.severity]
   * @param {number|string} [opts.cvss]
   * @param {string} [opts.owasp]
   * @param {string} [opts.mitre]
   * @param {string} [opts.status]
   * @param {string} [opts.proof]
   * @param {string} [opts.remediation]
   * @param {string} [opts.description]
   * @param {string} [opts.affected_url]
   * @param {Object} [opts.metadata]
   */
  constructor(opts = {}) {
    if (!opts.title) {
      throw new Error('Finding title is required');
    }

    this.id = opts.id || Finding.generateId();
    this.title = opts.title;
    this.severity = opts.severity || Severity.INFO;
    this.cvss = opts.cvss || null;
    this.owasp = opts.owasp || null;
    this.mitre = opts.mitre || null;
    this.status = opts.status || FindingStatus.OPEN;
    this.proof = opts.proof || null;
    this.remediation = opts.remediation || null;
    this.description = opts.description || null;
    this.affected_url = opts.affected_url || null;
    this.metadata = opts.metadata || {};
    this.created_at = new Date().toISOString();
    this.updated_at = this.created_at;
  }

  static generateId() {
    return `FIND-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Update finding status with audit trail.
   * @param {string} newStatus
   * @param {string} [reason]
   */
  updateStatus(newStatus, reason) {
    const validStatuses = Object.values(FindingStatus);
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    this.metadata.status_history = this.metadata.status_history || [];
    this.metadata.status_history.push({
      from: this.status,
      to: newStatus,
      reason: reason || null,
      timestamp: new Date().toISOString(),
    });

    this.status = newStatus;
    this.updated_at = new Date().toISOString();
  }

  /**
   * Calculate a numeric priority score for sorting.
   * Higher = more urgent.
   */
  get priorityScore() {
    const severityWeight = {
      [Severity.CRITICAL]: 100,
      [Severity.HIGH]: 75,
      [Severity.MEDIUM]: 50,
      [Severity.LOW]: 25,
      [Severity.INFO]: 10,
    };

    const statusWeight = {
      [FindingStatus.OPEN]: 1.0,
      [FindingStatus.CONFIRMED]: 1.2,
      [FindingStatus.FALSE_POSITIVE]: 0,
      [FindingStatus.REMEDIATED]: 0,
      [FindingStatus.ACCEPTED_RISK]: 0.1,
    };

    return (severityWeight[this.severity] || 0) * (statusWeight[this.status] || 1);
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      severity: this.severity,
      cvss: this.cvss,
      owasp: this.owasp,
      mitre: this.mitre,
      status: this.status,
      proof: this.proof,
      remediation: this.remediation,
      description: this.description,
      affected_url: this.affected_url,
      metadata: this.metadata,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}

module.exports = { Finding, Severity, FindingStatus };
