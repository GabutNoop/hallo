'use strict';

const Severity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

/**
 * Report generator — produces structured security reports.
 */
class ReportGenerator {
  /**
   * Generate a risk dashboard from findings.
   * @param {Object[]} findings
   * @returns {Object}
   */
  static generateRiskDashboard(findings) {
    const categories = {
      Authentication: ['auth', 'session', 'jwt', 'password', 'login', 'cookie', 'oauth'],
      'Input Validation': ['xss', 'sqli', 'injection', 'traversal', 'ssrf', 'ssti', 'command'],
      'API Security': ['api', 'idor', 'bola', 'graphql', 'endpoint', 'rate_limit', 'mass_assignment'],
      Infrastructure: ['header', 'ssl', 'tls', 'port', 'dns', 'cdn', 'waf', 'exposure'],
    };

    const dashboard = {};
    let total = 0;
    let highestSeverity = 'info';

    const severityOrder = ['info', 'low', 'medium', 'high', 'critical'];

    Object.keys(categories).forEach((cat) => {
      const catFindings = findings.filter((f) => {
        const text = `${f.title} ${f.description || ''}`.toLowerCase();
        return categories[cat].some((keyword) => text.includes(keyword));
      });

      const catHighest = catFindings.reduce((max, f) => {
        return severityOrder.indexOf(f.severity) > severityOrder.indexOf(max) ? f.severity : max;
      }, 'info');

      dashboard[cat] = {
        count: catFindings.length,
        highest_severity: catFindings.length > 0 ? catHighest : 'N/A',
      };

      total += catFindings.length;
      if (severityOrder.indexOf(catHighest) > severityOrder.indexOf(highestSeverity)) {
        highestSeverity = catHighest;
      }
    });

    dashboard.TOTAL = { count: total, highest_severity: highestSeverity };
    return dashboard;
  }

  /**
   * Generate remediation roadmap based on findings.
   * @param {Object[]} findings
   * @returns {Object}
   */
  static generateRemediationRoadmap(findings) {
    const roadmap = {
      immediate: [], // 24h — critical/high + easy fix
      short_term: [], // 1 week — medium priority
      medium_term: [], // 1 month — low priority / complex fixes
    };

    findings.forEach((f) => {
      if (f.status === 'remediated' || f.status === 'false_positive') return;

      if (f.severity === Severity.CRITICAL || f.severity === Severity.HIGH) {
        roadmap.immediate.push({
          finding: f.title,
          severity: f.severity,
          remediation: f.remediation,
        });
      } else if (f.severity === Severity.MEDIUM) {
        roadmap.short_term.push({
          finding: f.title,
          severity: f.severity,
          remediation: f.remediation,
        });
      } else {
        roadmap.medium_term.push({
          finding: f.title,
          severity: f.severity,
          remediation: f.remediation,
        });
      }
    });

    return roadmap;
  }

  /**
   * Calculate security score.
   * @param {Object[]} findings
   * @param {number} [headerScore] - Security headers score (0-100)
   * @returns {Object}
   */
  static calculateSecurityScore(findings, headerScore = 100) {
    let score = 100;

    const active = findings.filter(
      (f) => f.status !== 'remediated' && f.status !== 'false_positive'
    );

    active.forEach((f) => {
      switch (f.severity) {
        case Severity.CRITICAL:
          score -= 25;
          break;
        case Severity.HIGH:
          score -= 15;
          break;
        case Severity.MEDIUM:
          score -= 8;
          break;
        case Severity.LOW:
          score -= 3;
          break;
      }
    });

    // Factor in security headers (20% weight)
    const headerWeight = 0.2;
    score = score * (1 - headerWeight) + headerScore * headerWeight;

    score = Math.max(0, Math.min(100, Math.round(score)));

    const targetScore = 85;
    const gap = targetScore - score;

    return {
      current: score,
      target: targetScore,
      gap: Math.max(0, gap),
      grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 50 ? 'D' : 'F',
      on_target: score >= targetScore,
    };
  }

  /**
   * Generate a full report.
   * @param {Object} data
   * @param {string} data.domain
   * @param {Object[]} data.findings
   * @param {number} [data.headerScore]
   * @returns {Object}
   */
  static generateFullReport(data) {
    const { domain, findings, headerScore } = data;

    return {
      domain,
      generated_at: new Date().toISOString(),
      dashboard: ReportGenerator.generateRiskDashboard(findings),
      score: ReportGenerator.calculateSecurityScore(findings, headerScore),
      roadmap: ReportGenerator.generateRemediationRoadmap(findings),
      findings_by_priority: findings
        .filter((f) => f.status !== 'remediated' && f.status !== 'false_positive')
        .sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
          return (order[a.severity] || 5) - (order[b.severity] || 5);
        })
        .slice(0, 10),
    };
  }
}

module.exports = { ReportGenerator };
