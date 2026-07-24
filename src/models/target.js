'use strict';

/**
 * Target model — represents an authorized security assessment target.
 */
class Target {
  /**
   * @param {Object} opts
   * @param {string} opts.domain
   * @param {string} [opts.owner]
   * @param {string} [opts.scope]
   * @param {string} [opts.auth_type]
   * @param {string} [opts.operator]
   * @param {string} [opts.tech_stack]
   * @param {number} [opts.risk_score]
   * @param {string} [opts.last_scan]
   * @param {string[]} [opts.ips]
   * @param {Object} [opts.metadata]
   */
  constructor(opts = {}) {
    if (!opts.domain) {
      throw new Error('Target domain is required');
    }

    this.domain = opts.domain;
    this.owner = opts.owner || 'Self-Owned';
    this.scope = opts.scope || 'Full Assessment';
    this.auth_type = opts.auth_type || 'Self-Assessment';
    this.operator = opts.operator || 'Admin';
    this.tech_stack = opts.tech_stack || null;
    this.risk_score = opts.risk_score ?? null;
    this.last_scan = opts.last_scan || null;
    this.ips = opts.ips || [];
    this.metadata = opts.metadata || {};
    this.created_at = new Date().toISOString();
  }

  /**
   * Validate target data integrity.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];

    if (!this.domain || typeof this.domain !== 'string') {
      errors.push('Domain must be a non-empty string');
    }

    if (this.risk_score !== null && (this.risk_score < 0 || this.risk_score > 100)) {
      errors.push('Risk score must be between 0 and 100');
    }

    if (this.scope && typeof this.scope !== 'string') {
      errors.push('Scope must be a string');
    }

    return { valid: errors.length === 0, errors };
  }

  toJSON() {
    return {
      domain: this.domain,
      owner: this.owner,
      scope: this.scope,
      auth_type: this.auth_type,
      operator: this.operator,
      tech_stack: this.tech_stack,
      risk_score: this.risk_score,
      last_scan: this.last_scan,
      ips: this.ips,
      metadata: this.metadata,
      created_at: this.created_at,
    };
  }
}

module.exports = { Target };
