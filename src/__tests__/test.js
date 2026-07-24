'use strict';

const assert = require('assert');

// Simple test runner
let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ name, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function describe(suite, fn) {
  console.log(`\n🧪 ${suite}`);
  fn();
}

// ==================== TESTS ====================

const { Target } = require('../models/target');
const { Finding, Severity, FindingStatus } = require('../models/finding');
const { VPS } = require('../models/vps');
const { buildMasterSecurityPrompt } = require('../prompts/masterSecurityPrompt');
const { ReportGenerator } = require('../report');
const { RedOps } = require('..');

describe('Target Model', () => {
  test('should create a valid target', () => {
    const target = new Target({ domain: 'test.com', owner: 'Test' });
    assert.strictEqual(target.domain, 'test.com');
    assert.strictEqual(target.owner, 'Test');
  });

  test('should throw if no domain', () => {
    assert.throws(() => new Target({}), /domain is required/);
  });

  test('should validate correctly', () => {
    const target = new Target({ domain: 'test.com', risk_score: 50 });
    const result = target.validate();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('should reject invalid risk score', () => {
    const target = new Target({ domain: 'test.com', risk_score: 150 });
    const result = target.validate();
    assert.strictEqual(result.valid, false);
  });

  test('should serialize to JSON', () => {
    const target = new Target({ domain: 'test.com' });
    const json = target.toJSON();
    assert.strictEqual(json.domain, 'test.com');
    assert.ok(json.created_at);
  });
});

describe('Finding Model', () => {
  test('should create a valid finding', () => {
    const finding = new Finding({ title: 'XSS in search', severity: 'high' });
    assert.strictEqual(finding.title, 'XSS in search');
    assert.strictEqual(finding.severity, 'high');
    assert.ok(finding.id.startsWith('FIND-'));
  });

  test('should throw if no title', () => {
    assert.throws(() => new Finding({}), /title is required/);
  });

  test('should update status with history', () => {
    const finding = new Finding({ title: 'Test', status: 'open' });
    finding.updateStatus('confirmed', 'Verified by analyst');
    assert.strictEqual(finding.status, 'confirmed');
    assert.strictEqual(finding.metadata.status_history.length, 1);
    assert.strictEqual(finding.metadata.status_history[0].from, 'open');
    assert.strictEqual(finding.metadata.status_history[0].to, 'confirmed');
  });

  test('should reject invalid status', () => {
    const finding = new Finding({ title: 'Test' });
    assert.throws(() => finding.updateStatus('invalid'), /Invalid status/);
  });

  test('should calculate priority score', () => {
    const critical = new Finding({ title: 'Critical', severity: 'critical', status: 'confirmed' });
    const low = new Finding({ title: 'Low', severity: 'low', status: 'open' });
    assert.ok(critical.priorityScore > low.priorityScore);
  });
});

describe('VPS Model', () => {
  test('should create a valid VPS', () => {
    const vps = new VPS({ hostname: 'srv-01', ip: '10.0.0.1' });
    assert.strictEqual(vps.hostname, 'srv-01');
  });

  test('should throw if no hostname or IP', () => {
    assert.throws(() => new VPS({}), /hostname or IP is required/);
  });

  test('should detect risky ports', () => {
    const vps = new VPS({ hostname: 'srv-01', ip: '10.0.0.1', open_ports: [22, 80, 3306, 6379] });
    const risky = vps.getRiskyPorts();
    assert.strictEqual(risky.length, 2); // 3306 and 6379
    assert.ok(risky.find((r) => r.port === 3306));
    assert.ok(risky.find((r) => r.port === 6379));
  });

  test('should assess health', () => {
    const vps = new VPS({
      hostname: 'srv-01',
      ip: '10.0.0.1',
      open_ports: [22, 80, 443],
      hardening_score: 85,
    });
    const assessment = vps.assess();
    assert.strictEqual(assessment.grade, 'A');
  });

  test('should give F grade for low hardening', () => {
    const vps = new VPS({
      hostname: 'srv-01',
      ip: '10.0.0.1',
      hardening_score: 20,
    });
    const assessment = vps.assess();
    assert.strictEqual(assessment.grade, 'F');
  });
});

describe('Master Security Prompt', () => {
  test('should generate prompt with target data', () => {
    const prompt = buildMasterSecurityPrompt(
      { domain: 'test.com', owner: 'TestOrg' },
      null,
      null,
      null
    );
    assert.ok(prompt.includes('test.com'));
    assert.ok(prompt.includes('TestOrg'));
    assert.ok(prompt.includes('PHASE 1'));
    assert.ok(prompt.includes('PHASE 5'));
  });

  test('should include scan logs when available', () => {
    const prompt = buildMasterSecurityPrompt(
      { domain: 'test.com' },
      { type: 'full', logs: ['Found /api endpoint', 'Server: nginx'] },
      null,
      null
    );
    assert.ok(prompt.includes('Found /api endpoint'));
    assert.ok(prompt.includes('Server: nginx'));
  });

  test('should include findings when available', () => {
    const prompt = buildMasterSecurityPrompt(
      { domain: 'test.com' },
      null,
      [{ title: 'XSS found', severity: 'high', cvss: 7.5, status: 'open' }],
      null
    );
    assert.ok(prompt.includes('XSS found'));
    assert.ok(prompt.includes('[HIGH]'));
  });

  test('should include VPS data when available', () => {
    const prompt = buildMasterSecurityPrompt(
      { domain: 'test.com' },
      null,
      null,
      { hostname: 'srv-01', ip: '10.0.0.1', open_ports: [22, 80], hardening_score: 75 }
    );
    assert.ok(prompt.includes('srv-01'));
    assert.ok(prompt.includes('10.0.0.1'));
  });

  test('should show pending when no scan data', () => {
    const prompt = buildMasterSecurityPrompt({ domain: 'test.com' }, null, null, null);
    assert.ok(prompt.includes('[PENDING]'));
  });
});

describe('Report Generator', () => {
  test('should generate risk dashboard', () => {
    const findings = [
      { title: 'XSS in search', severity: 'high', status: 'open' },
      { title: 'Missing HSTS header', severity: 'medium', status: 'open' },
    ];
    const dashboard = ReportGenerator.generateRiskDashboard(findings);
    assert.ok(dashboard.TOTAL);
    assert.strictEqual(dashboard.TOTAL.count, 2);
  });

  test('should calculate security score', () => {
    const findings = [
      { title: 'Critical vuln', severity: 'critical', status: 'open' },
    ];
    const score = ReportGenerator.calculateSecurityScore(findings);
    assert.ok(score.current < 100);
    // Critical = -25, blended with 100 header score at 20% weight: (75*0.8)+(100*0.2) = 80
    assert.ok(score.current <= 80);
  });

  test('should generate remediation roadmap', () => {
    const findings = [
      { title: 'Critical', severity: 'critical', status: 'open', remediation: 'Fix now' },
      { title: 'Medium', severity: 'medium', status: 'open', remediation: 'Fix later' },
      { title: 'Low', severity: 'low', status: 'open', remediation: 'Fix eventually' },
    ];
    const roadmap = ReportGenerator.generateRemediationRoadmap(findings);
    assert.strictEqual(roadmap.immediate.length, 1);
    assert.strictEqual(roadmap.short_term.length, 1);
    assert.strictEqual(roadmap.medium_term.length, 1);
  });

  test('should exclude remediated findings from roadmap', () => {
    const findings = [
      { title: 'Fixed', severity: 'critical', status: 'remediated', remediation: 'Done' },
    ];
    const roadmap = ReportGenerator.generateRemediationRoadmap(findings);
    assert.strictEqual(roadmap.immediate.length, 0);
  });
});

describe('RedOps Orchestrator', () => {
  test('should register target and add findings', () => {
    const redops = new RedOps();
    redops.registerTarget({ domain: 'test.com' });
    const finding = redops.addFinding('test.com', { title: 'Test vuln', severity: 'high' });
    assert.ok(finding.id);
    assert.strictEqual(redops.getFindings('test.com').length, 1);
  });

  test('should throw for unregistered target', () => {
    const redops = new RedOps();
    assert.throws(() => redops.addFinding('nope.com', { title: 'Test' }), /not registered/);
  });

  test('should generate risk summary', () => {
    const redops = new RedOps();
    redops.registerTarget({ domain: 'test.com' });
    redops.addFinding('test.com', { title: 'Critical issue', severity: 'critical' });
    const summary = redops.getRiskSummary('test.com');
    assert.ok(summary.risk_score < 100);
    assert.strictEqual(summary.active_findings, 1);
  });

  test('should export all data', () => {
    const redops = new RedOps();
    redops.registerTarget({ domain: 'test.com' });
    redops.registerVPS({ hostname: 'srv-01', ip: '10.0.0.1' });
    redops.addFinding('test.com', { title: 'Test' });
    const data = redops.export();
    assert.strictEqual(data.targets.length, 1);
    assert.strictEqual(data.vps_nodes.length, 1);
    assert.strictEqual(data.findings.length, 1);
  });

  test('should generate master prompt', () => {
    const redops = new RedOps();
    redops.registerTarget({ domain: 'test.com', owner: 'TestOrg' });
    const prompt = redops.generatePrompt('test.com');
    assert.ok(prompt.includes('test.com'));
    assert.ok(prompt.includes('REDOPS'));
  });
});

// ==================== SUMMARY ====================

console.log(`\n${'═'.repeat(50)}`);
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (errors.length > 0) {
  console.log('\nFailed tests:');
  errors.forEach((e) => console.log(`  ❌ ${e.name}: ${e.error}`));
}

console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
