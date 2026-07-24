#!/usr/bin/env node
'use strict';

const { RedOps } = require('..');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────
// CLI Argument Parser (zero dependencies)
// ─────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [], flags: {} };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx > -1) {
        args.flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        args.flags[key] = argv[i + 1];
        i++;
      } else {
        args.flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        args.flags[key] = argv[i + 1];
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(arg);
    }
    i++;
  }

  return args;
}

// ─────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function colorize(text, color) {
  if (process.env.NO_COLOR) return text;
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function severityColor(severity) {
  const map = { critical: 'bgRed', high: 'red', medium: 'yellow', low: 'blue', info: 'dim' };
  return colorize(` ${severity.toUpperCase().padEnd(8)} `, map[severity] || 'dim');
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => {
    const maxData = rows.reduce((max, r) => Math.max(max, String(r[i] || '').length), 0);
    return Math.max(h.length, maxData);
  });

  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const header = headers.map((h, i) => ` ${colorize(h.padEnd(widths[i]), 'bold')} `).join('│');

  console.log(`┌${sep.replace(/┼/g, '┬')}┐`);
  console.log(`│${header}│`);
  console.log(`├${sep}┤`);

  rows.forEach((row) => {
    const line = row.map((cell, i) => ` ${String(cell || '').padEnd(widths[i])} `).join('│');
    console.log(`│${line}│`);
  });

  console.log(`└${sep.replace(/┼/g, '┴')}┘`);
}

function printBanner() {
  console.log(colorize(`
╔═══════════════════════════════════════════════╗
║        RedOps Security Analyzer v2.0          ║
║     Authorized Assessment Tool                ║
╚═══════════════════════════════════════════════╝`, 'cyan'));
}

// ─────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────

async function cmdAdd(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops add <domain>', 'red'));
    process.exit(1);
  }

  const target = redops.registerTarget({
    domain,
    owner: args.flags.owner || args.flags.o,
    scope: args.flags.scope || args.flags.s,
    auth_type: args.flags.auth || 'Self-Assessment',
    operator: args.flags.operator,
    notes: args.flags.notes,
  });

  console.log(colorize(`✓ Target registered: ${target.domain}`, 'green'));
  if (args.flags.json) console.log(JSON.stringify(target, null, 2));
}

async function cmdList(args, redops) {
  const targets = redops.getTargets();

  if (targets.length === 0) {
    console.log(colorize('No targets registered. Use: redops add <domain>', 'yellow'));
    return;
  }

  if (args.flags.json) {
    console.log(JSON.stringify(targets, null, 2));
    return;
  }

  console.log(colorize(`\n📋 Registered Targets (${targets.length})\n`, 'bold'));

  const rows = targets.map((t) => [
    t.domain,
    t.scope || '-',
    t.tech_stack || 'Unknown',
    t.risk_score || '-',
    t.last_scan ? new Date(t.last_scan).toLocaleDateString() : 'Never',
  ]);

  printTable(['Domain', 'Scope', 'Tech Stack', 'Risk', 'Last Scan'], rows);
}

async function cmdRecon(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops recon <domain>', 'red'));
    process.exit(1);
  }

  const scan = await redops.passiveRecon(domain, {
    timeout: parseInt(args.flags.timeout) || 10000,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  // Print results
  console.log(colorize(`\n🔍 Recon Results for ${domain}\n`, 'bold'));

  if (scan.results.dns) {
    console.log(colorize('DNS Records:', 'cyan'));
    console.log(`  A    : ${scan.results.dns.a.join(', ') || 'none'}`);
    console.log(`  AAAA : ${scan.results.dns.aaaa.join(', ') || 'none'}`);
    console.log(`  MX   : ${scan.results.dns.mx.join(', ') || 'none'}`);
    console.log(`  NS   : ${scan.results.dns.ns.join(', ') || 'none'}`);
    console.log(`  TXT  : ${scan.results.dns.txt.slice(0, 3).join(' | ') || 'none'}`);
  }

  if (scan.results.headers) {
    console.log(colorize('\nHTTP Analysis:', 'cyan'));
    console.log(`  Status    : ${scan.results.headers.status}`);
    console.log(`  Response  : ${scan.results.headers.response_time_ms}ms`);
    console.log(`  Security  : ${scan.results.headers.security.score}/100`);
    console.log(`  Techs     : ${scan.results.headers.technologies.join(', ') || 'none detected'}`);

    if (scan.results.headers.security.missing.length > 0) {
      console.log(colorize(`  Missing   : ${scan.results.headers.security.missing.join(', ')}`, 'yellow'));
    }

    if (scan.results.headers.info_leaks.length > 0) {
      console.log(colorize('  Leaks:', 'red'));
      scan.results.headers.info_leaks.forEach((l) => {
        console.log(`    ${l.header}: ${l.value}`);
      });
    }
  }

  if (scan.results.ssl) {
    console.log(colorize('\nSSL/TLS:', 'cyan'));
    if (scan.results.ssl.valid) {
      console.log(`  Protocol  : ${scan.results.ssl.protocol}`);
      console.log(`  Cipher    : ${scan.results.ssl.cipher}`);
      console.log(`  Issuer    : ${scan.results.ssl.issuer?.CN || 'Unknown'}`);
      console.log(`  Expires   : ${scan.results.ssl.valid_to} (${scan.results.ssl.days_until_expiry} days)`);
      if (scan.results.ssl.self_signed) {
        console.log(colorize('  ⚠ Self-signed certificate!', 'yellow'));
      }
      if (scan.results.ssl.days_until_expiry < 30) {
        console.log(colorize('  ⚠ Certificate expiring soon!', 'red'));
      }
    } else {
      console.log(colorize(`  ✗ ${scan.results.ssl.error}`, 'red'));
    }
  }

  if (scan.results.whois) {
    console.log(colorize('\nWHOIS/RDAP:', 'cyan'));
    console.log(`  Registrar : ${scan.results.whois.registrar || 'Unknown'}`);
    console.log(`  Status    : ${(scan.results.whois.status || []).join(', ')}`);
    const created = scan.results.whois.events?.find((e) => e.action === 'registration');
    const expires = scan.results.whois.events?.find((e) => e.action === 'expiration');
    if (created) console.log(`  Created   : ${created.date}`);
    if (expires) console.log(`  Expires   : ${expires.date}`);
  }

  if (scan.errors.length > 0) {
    console.log(colorize('\n⚠ Errors:', 'yellow'));
    scan.errors.forEach((e) => console.log(`  [${e.module}] ${e.error}`));
  }
}

async function cmdPorts(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops ports <domain> [--profile web|full]', 'red'));
    process.exit(1);
  }

  const scan = await redops.portScan(domain, {
    profile: args.flags.profile || 'web',
    timeout: parseInt(args.flags.timeout) || 3000,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  const result = scan.results;
  console.log(colorize(`\n🔌 Port Scan: ${result.host}\n`, 'bold'));
  console.log(`  Scanned : ${result.scanned} ports`);
  console.log(colorize(`  Open    : ${result.open.length > 0 ? result.open.join(', ') : 'none'}`, result.open.length > 0 ? 'red' : 'green'));
  console.log(`  Filtered: ${result.filtered.length > 0 ? result.filtered.join(', ') : 'none'}`);
  console.log(colorize(`  Closed  : ${result.closed.length}`, 'dim'));
}

async function cmdFiles(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops files <domain>', 'red'));
    process.exit(1);
  }

  const scan = await redops.detectFiles(domain, {
    timeout: parseInt(args.flags.timeout) || 5000,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }

  const result = scan.results;
  console.log(colorize(`\n📁 Exposed Files: ${domain}\n`, 'bold'));
  console.log(`  Checked: ${result.checked} paths`);
  console.log(`  Found  : ${result.found.length} accessible\n`);

  if (result.found.length > 0) {
    const rows = result.found.map((f) => [
      f.path,
      f.status,
      f.content_type || '-',
      f.content_length || '-',
    ]);
    printTable(['Path', 'Status', 'Content-Type', 'Size'], rows);
  } else {
    console.log(colorize('  ✓ No sensitive files found', 'green'));
  }
}

async function cmdScan(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops scan <domain> [--full]', 'red'));
    process.exit(1);
  }

  const result = await redops.fullAssessment(domain, {
    port_profile: args.flags.full ? 'full' : 'web',
    timeout: parseInt(args.flags.timeout) || 10000,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(colorize(`\n✅ Full Assessment Complete: ${domain} (${result.duration_seconds}s)\n`, 'bold'));

  const summary = redops.getRiskSummary(domain);
  const scoreColor = summary.risk_score >= 80 ? 'green' : summary.risk_score >= 50 ? 'yellow' : 'red';
  console.log(`  Risk Score : ${colorize(summary.risk_score + '/100', scoreColor)}`);
  console.log(`  Findings   : ${summary.total_findings} (${summary.active_findings} active)`);
  console.log(`  Scans      : ${summary.total_scans}`);

  if (summary.by_severity.critical > 0 || summary.by_severity.high > 0) {
    console.log(colorize(`\n  ⚠ ${summary.by_severity.critical} critical, ${summary.by_severity.high} high severity findings!`, 'red'));
  }
}

async function cmdFindings(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops findings <domain>', 'red'));
    process.exit(1);
  }

  const findings = redops.getFindings(domain, {
    severity: args.flags.severity,
    status: args.flags.status,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  if (findings.length === 0) {
    console.log(colorize('No findings.', 'green'));
    return;
  }

  console.log(colorize(`\n🐛 Findings for ${domain} (${findings.length})\n`, 'bold'));

  findings.forEach((f) => {
    console.log(`  ${severityColor(f.severity)} ${f.title}`);
    console.log(`  ${colorize('ID:', 'dim')} ${f.id}  ${colorize('Status:', 'dim')} ${f.status}`);
    if (f.cvss) console.log(`  ${colorize('CVSS:', 'dim')} ${f.cvss}  ${colorize('OWASP:', 'dim')} ${f.owasp || '-'}`);
    if (f.affected_url) console.log(`  ${colorize('URL:', 'dim')} ${f.affected_url}`);
    if (f.remediation) console.log(`  ${colorize('Fix:', 'dim')} ${f.remediation}`);
    console.log();
  });
}

async function cmdReport(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops report <domain> [--output file.json]', 'red'));
    process.exit(1);
  }

  const report = redops.generateReport(domain);

  if (args.flags.output || args.flags.o) {
    const outFile = args.flags.output || args.flags.o;
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(colorize(`✓ Report saved to ${outFile}`, 'green'));
    return;
  }

  if (args.flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Pretty print
  console.log(colorize(`\n📊 Security Report: ${domain}\n`, 'bold'));

  const score = report.report.score;
  const scoreColor = score.current >= 80 ? 'green' : score.current >= 50 ? 'yellow' : 'red';
  console.log(`  Security Score: ${colorize(score.current + '/100', scoreColor)} (Grade: ${score.grade})`);
  console.log(`  Target Score  : ${score.target}/100  Gap: ${score.gap}\n`);

  const dash = report.report.dashboard;
  console.log(colorize('  Risk Dashboard:', 'cyan'));
  const dashRows = Object.entries(dash).map(([cat, data]) => [
    cat,
    data.count,
    data.highest_severity !== 'N/A' ? data.highest_severity.toUpperCase() : '-',
  ]);
  printTable(['Category', 'Count', 'Highest'], dashRows);

  const roadmap = report.report.roadmap;
  if (roadmap.immediate.length > 0) {
    console.log(colorize('\n  🔴 IMMEDIATE (24h):', 'red'));
    roadmap.immediate.forEach((f) => console.log(`    • ${f.finding}`));
  }
  if (roadmap.short_term.length > 0) {
    console.log(colorize('\n  🟠 SHORT-TERM (1 week):', 'yellow'));
    roadmap.short_term.forEach((f) => console.log(`    • ${f.finding}`));
  }
  if (roadmap.medium_term.length > 0) {
    console.log(colorize('\n  🟡 MEDIUM-TERM (1 month):', 'blue'));
    roadmap.medium_term.forEach((f) => console.log(`    • ${f.finding}`));
  }
}

async function cmdPrompt(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops prompt <domain> [--output file.txt]', 'red'));
    process.exit(1);
  }

  const prompt = redops.generatePrompt(domain);

  if (args.flags.output || args.flags.o) {
    const outFile = args.flags.output || args.flags.o;
    fs.writeFileSync(outFile, prompt);
    console.log(colorize(`✓ Prompt saved to ${outFile} (${prompt.length} chars)`, 'green'));
    return;
  }

  console.log(prompt);
}

async function cmdExport(args, redops) {
  const data = redops.exportAll();
  const outFile = args.flags.output || args.flags.o || `redops-export-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(colorize(`✓ Exported to ${outFile}`, 'green'));
}

async function cmdRemove(args, redops) {
  const domain = args._[1];
  if (!domain) {
    console.error(colorize('Error: domain required. Usage: redops remove <domain>', 'red'));
    process.exit(1);
  }

  redops.deleteTarget(domain);
  console.log(colorize(`✓ Target removed: ${domain}`, 'green'));
}

function cmdHelp() {
  printBanner();
  console.log(`
${colorize('USAGE', 'bold')}
  redops <command> [args] [options]

${colorize('TARGET MANAGEMENT', 'bold')}
  ${colorize('add <domain>', 'cyan')}           Register authorized target
    --owner <name>              Target owner
    --scope <scope>             Assessment scope
    --auth <type>               Authorization type

  ${colorize('list', 'cyan')}                 List all registered targets
  ${colorize('remove <domain>', 'cyan')}      Remove target and all data

${colorize('RECONNAISSANCE', 'bold')}
  ${colorize('recon <domain>', 'cyan')}       Passive recon (DNS, headers, SSL, WHOIS)
  ${colorize('ports <domain>', 'cyan')}       TCP port scan
    --profile web|full          Port profile (default: web)
    --timeout <ms>              Connection timeout

  ${colorize('files <domain>', 'cyan')}       Detect exposed sensitive files
  ${colorize('scan <domain>', 'cyan')}        Full assessment (recon + ports + files)
    --full                      Use full port list
    --timeout <ms>              Request timeout

${colorize('FINDINGS', 'bold')}
  ${colorize('findings <domain>', 'cyan')}    List findings
    --severity <level>          Filter by severity
    --status <status>           Filter by status

${colorize('REPORTS', 'bold')}
  ${colorize('report <domain>', 'cyan')}      Generate security report
  ${colorize('prompt <domain>', 'cyan')}      Generate AI analysis prompt
    --output <file>             Save to file
    --json                      JSON output

${colorize('DATA', 'bold')}
  ${colorize('export', 'cyan')}               Export all data as JSON
    --output <file>             Output file path

${colorize('GLOBAL OPTIONS', 'bold')}
  --json                       Output as JSON
  --data-dir <path>            Custom data directory
  --verbose                    Verbose logging
  --help                       Show this help

${colorize('EXAMPLES', 'bold')}
  redops add example.com --owner "Acme Corp" --scope "Web + API"
  redops recon example.com
  redops scan example.com --full
  redops report example.com --output report.json
  redops prompt example.com --output prompt.txt
`);
}

// ─────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  if (args.flags.help || args.flags.h || !command) {
    cmdHelp();
    return;
  }

  const redops = new RedOps({
    dataDir: args.flags['data-dir'] || path.join(process.cwd(), 'data'),
    verbose: !!args.flags.verbose,
  });

  const commands = {
    add: cmdAdd,
    list: cmdList,
    ls: cmdList,
    recon: cmdRecon,
    ports: cmdPorts,
    files: cmdFiles,
    scan: cmdScan,
    findings: cmdFindings,
    report: cmdReport,
    prompt: cmdPrompt,
    export: cmdExport,
    remove: cmdRemove,
    rm: cmdRemove,
  };

  const handler = commands[command];
  if (!handler) {
    console.error(colorize(`Unknown command: ${command}`, 'red'));
    console.log('Run "redops --help" for usage.');
    process.exit(1);
  }

  try {
    await handler(args, redops);
  } catch (err) {
    console.error(colorize(`\nError: ${err.message}`, 'red'));
    if (args.flags.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
