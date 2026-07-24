'use strict';

const { RedOps } = require('./index');

/**
 * Example: Full RedOps workflow demonstration
 */
async function main() {
  const redops = new RedOps();

  // 1. Register an authorized target
  const target = redops.registerTarget({
    domain: 'example.com',
    owner: 'Acme Corp',
    scope: 'Web Application + API',
    auth_type: 'Written Authorization',
    operator: 'security-team',
    tech_stack: 'Next.js + Express + PostgreSQL',
    risk_score: 45,
  });

  console.log('\n✅ Target registered:', target.domain);

  // 2. Register VPS infrastructure
  const vps = redops.registerVPS({
    hostname: 'web-prod-01',
    ip: '203.0.113.42',
    os: 'Ubuntu 22.04 LTS',
    open_ports: [22, 80, 443, 3306, 6379, 8080],
    hardening_score: 62,
    status: 'running',
    threats_blocked: 1847,
  });

  console.log('✅ VPS registered:', vps.hostname);
  console.log('   Risky ports:', vps.getRiskyPorts().map((p) => `${p.port} (${p.risk})`).join(', '));
  console.log('   Assessment:', vps.assess().grade, vps.assess().issues);

  // 3. Add some findings
  redops.addFinding('example.com', {
    title: 'Missing Content-Security-Policy Header',
    severity: 'medium',
    cvss: 6.1,
    owasp: 'A05:2021 - Security Misconfiguration',
    mitre: 'T1189 - Drive-by Compromise',
    status: 'open',
    proof: 'Response headers do not include Content-Security-Policy',
    remediation: 'Add Content-Security-Policy header with restrictive policy',
  });

  redops.addFinding('example.com', {
    title: 'JWT Token Not Validated Server-Side',
    severity: 'critical',
    cvss: 9.1,
    owasp: 'A07:2021 - Identification and Authentication Failures',
    mitre: 'T1550 - Use Alternate Authentication Material',
    status: 'confirmed',
    proof: 'JWT with alg:none accepted by /api/v1/admin endpoint',
    remediation: 'Validate JWT signature server-side, reject alg:none tokens',
  });

  redops.addFinding('example.com', {
    title: 'Redis Exposed on Public Interface',
    severity: 'high',
    cvss: 7.5,
    owasp: 'A01:2021 - Broken Access Control',
    mitre: 'T1078 - Valid Accounts',
    status: 'open',
    proof: 'Redis 7.0 on port 6379 accessible from 0.0.0.0 without authentication',
    remediation: 'Bind Redis to 127.0.0.1, enable requirepass, add firewall rules',
  });

  console.log('\n✅ 3 findings added');

  // 4. Get risk summary
  const summary = redops.getRiskSummary('example.com');
  console.log('\n📊 Risk Summary:');
  console.log('   Score:', summary.risk_score + '/100');
  console.log('   Active findings:', summary.active_findings);
  console.log('   By severity:', summary.by_severity);

  // 5. Generate the master prompt
  const prompt = redops.generatePrompt('example.com');
  console.log('\n📋 Master Security Prompt generated (' + prompt.length + ' chars)');
  console.log('\n--- PROMPT PREVIEW (first 500 chars) ---');
  console.log(prompt.substring(0, 500));
  console.log('--- END PREVIEW ---');

  // 6. Export all data
  const exported = redops.export();
  console.log('\n💾 Data exported:', {
    targets: exported.targets.length,
    findings: exported.findings.length,
    vps_nodes: exported.vps_nodes.length,
  });
}

main().catch(console.error);
