'use strict';

const dns = require('dns');
const net = require('net');
const tls = require('tls');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { promisify } = require('util');

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);
const dnsResolveMx = promisify(dns.resolveMx);
const dnsResolveTxt = promisify(dns.resolveTxt);
const dnsResolveNs = promisify(dns.resolveNs);
const dnsResolveCname = promisify(dns.resolveCname);

/**
 * Rate limiter — prevents overwhelming targets.
 */
class RateLimiter {
  constructor({ maxPerSecond = 5, maxPerMinute = 60 } = {}) {
    this.maxPerSecond = maxPerSecond;
    this.maxPerMinute = maxPerMinute;
    this.secondWindow = [];
    this.minuteWindow = [];
  }

  async acquire() {
    const now = Date.now();
    this.secondWindow = this.secondWindow.filter((t) => now - t < 1000);
    this.minuteWindow = this.minuteWindow.filter((t) => now - t < 60000);

    if (this.secondWindow.length >= this.maxPerSecond) {
      const wait = 1000 - (now - this.secondWindow[0]);
      await new Promise((r) => setTimeout(r, Math.max(wait, 100)));
      return this.acquire();
    }

    if (this.minuteWindow.length >= this.maxPerMinute) {
      const wait = 60000 - (now - this.minuteWindow[0]);
      await new Promise((r) => setTimeout(r, Math.max(wait, 100)));
      return this.acquire();
    }

    this.secondWindow.push(now);
    this.minuteWindow.push(now);
  }
}

/**
 * Real DNS recon — resolve all record types for a domain.
 * @param {string} domain
 * @returns {Promise<Object>}
 */
async function resolveDns(domain) {
  const results = {
    domain,
    timestamp: new Date().toISOString(),
    a: [],
    aaaa: [],
    mx: [],
    txt: [],
    ns: [],
    cname: [],
  };

  const tasks = [
    dnsResolve4(domain).then((r) => (results.a = r)).catch(() => {}),
    dnsResolve6(domain).then((r) => (results.aaaa = r)).catch(() => {}),
    dnsResolveMx(domain).then((r) => (results.mx = r.map((m) => `${m.priority} ${m.exchange}`))).catch(() => {}),
    dnsResolveTxt(domain).then((r) => (results.txt = r.map((t) => t.join('')))).catch(() => {}),
    dnsResolveNs(domain).then((r) => (results.ns = r)).catch(() => {}),
    dnsResolveCname(domain).then((r) => (results.cname = r)).catch(() => {}),
  ];

  await Promise.all(tasks);
  return results;
}

/**
 * TCP port scanner — checks if ports are open via TCP connect.
 * @param {string} host
 * @param {number[]} ports
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function scanPorts(host, ports, opts = {}) {
  const timeout = opts.timeout || 3000;
  const concurrency = opts.concurrency || 10;
  const open = [];
  const closed = [];
  const filtered = [];

  async function checkPort(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const done = (status) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve({ port, status });
      };

      socket.setTimeout(timeout);
      socket.on('connect', () => done('open'));
      socket.on('timeout', () => done('filtered'));
      socket.on('error', () => done('closed'));

      socket.connect(port, host);
    });
  }

  // Process in batches for concurrency control
  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(checkPort));
    results.forEach(({ port, status }) => {
      if (status === 'open') open.push(port);
      else if (status === 'filtered') filtered.push(port);
      else closed.push(port);
    });
  }

  return {
    host,
    timestamp: new Date().toISOString(),
    scanned: ports.length,
    open,
    closed,
    filtered,
  };
}

/**
 * SSL/TLS certificate analysis.
 * @param {string} host
 * @param {number} [port]
 * @returns {Promise<Object>}
 */
async function analyzeSsl(host, port = 443) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        timeout: 5000,
        rejectUnauthorized: false, // We want to inspect even invalid certs
      },
      () => {
        const cert = socket.getPeerCertificate(true);
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();

        // Check certificate chain
        let chainLength = 0;
        let current = cert;
        while (current) {
          chainLength++;
          current = current.issuerCertificate;
          if (current === cert) break; // Self-signed loop
        }

        socket.destroy();
        resolve({
          host,
          port,
          valid: true,
          protocol,
          cipher: cipher ? `${cipher.name} (${cipher.version})` : null,
          subject: cert.subject ? { CN: cert.subject.CN, O: cert.subject.O, C: cert.subject.C } : null,
          issuer: cert.issuer ? { CN: cert.issuer.CN, O: cert.issuer.O } : null,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          days_until_expiry: cert.valid_to
            ? Math.ceil((new Date(cert.valid_to) - Date.now()) / 86400000)
            : null,
          serial: cert.serialNumber,
          fingerprint_sha256: cert.fingerprint256,
          chain_length: chainLength,
          self_signed: cert.subject?.CN === cert.issuer?.CN,
          san: cert.subjectaltname || null,
          timestamp: new Date().toISOString(),
        });
      }
    );

    socket.on('error', (err) => {
      resolve({
        host,
        port,
        valid: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        host,
        port,
        valid: false,
        error: 'Connection timed out',
        timestamp: new Date().toISOString(),
      });
    });
  });
}

/**
 * HTTP header analysis — fetch and analyze response headers.
 * @param {string} targetUrl
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function analyzeHeaders(targetUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const timeout = opts.timeout || 10000;

    const req = client.request(
      parsedUrl,
      {
        method: 'GET',
        timeout,
        headers: {
          'User-Agent': 'RedOps/2.0 (Authorized Security Assessment)',
          Accept: '*/*',
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const rawHeaders = res.headers;
        const responseTime = Date.now() - startTime;

        // Normalize headers
        const headers = {};
        Object.entries(rawHeaders).forEach(([k, v]) => {
          headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        });

        // Security header analysis
        const securityChecks = {
          'content-security-policy': { present: !!headers['content-security-policy'], value: headers['content-security-policy'] || null, weight: 20 },
          'x-frame-options': { present: !!headers['x-frame-options'], value: headers['x-frame-options'] || null, weight: 10 },
          'strict-transport-security': { present: !!headers['strict-transport-security'], value: headers['strict-transport-security'] || null, weight: 20 },
          'x-content-type-options': { present: headers['x-content-type-options'] === 'nosniff', value: headers['x-content-type-options'] || null, weight: 10 },
          'referrer-policy': { present: !!headers['referrer-policy'], value: headers['referrer-policy'] || null, weight: 10 },
          'permissions-policy': { present: !!headers['permissions-policy'], value: headers['permissions-policy'] || null, weight: 10 },
          'x-xss-protection': { present: !!headers['x-xss-protection'], value: headers['x-xss-protection'] || null, weight: 5 },
          'cross-origin-opener-policy': { present: !!headers['cross-origin-opener-policy'], value: headers['cross-origin-opener-policy'] || null, weight: 5 },
          'cross-origin-resource-policy': { present: !!headers['cross-origin-resource-policy'], value: headers['cross-origin-resource-policy'] || null, weight: 5 },
          'cross-origin-embedder-policy': { present: !!headers['cross-origin-embedder-policy'], value: headers['cross-origin-embedder-policy'] || null, weight: 5 },
        };

        const totalWeight = Object.values(securityChecks).reduce((sum, c) => sum + c.weight, 0);
        const presentWeight = Object.values(securityChecks)
          .filter((c) => c.present)
          .reduce((sum, c) => sum + c.weight, 0);
        const score = Math.round((presentWeight / totalWeight) * 100);

        const missing = Object.entries(securityChecks)
          .filter(([, c]) => !c.present)
          .map(([h]) => h);

        // Cookie security
        const cookieHeader = headers['set-cookie'] || '';
        const cookies = cookieHeader ? cookieHeader.split(/,(?=\s*\w+=)/) : [];
        const cookieAnalysis = cookies.map((c) => {
          const name = c.split('=')[0].trim();
          return {
            name,
            httpOnly: /httponly/i.test(c),
            secure: /secure/i.test(c),
            sameSite: (c.match(/samesite=([^;]+)/i) || [])[1] || 'not set',
          };
        });

        // Info leakage detection
        const leaks = [];
        if (headers['server']) leaks.push({ header: 'Server', value: headers['server'], risk: 'info' });
        if (headers['x-powered-by']) leaks.push({ header: 'X-Powered-By', value: headers['x-powered-by'], risk: 'medium' });
        if (headers['x-aspnet-version']) leaks.push({ header: 'X-AspNet-Version', value: headers['x-aspnet-version'], risk: 'medium' });
        if (headers['x-aspnetmvc-version']) leaks.push({ header: 'X-AspNetMvc-Version', value: headers['x-aspnetmvc-version'], risk: 'medium' });

        // Technology fingerprinting
        const techs = [];
        if (headers['server']?.includes('cloudflare') || headers['cf-ray']) techs.push('Cloudflare');
        if (headers['server']?.includes('nginx')) techs.push('Nginx');
        if (headers['server']?.includes('Apache')) techs.push('Apache');
        if (headers['x-powered-by']?.includes('Express')) techs.push('Express.js');
        if (headers['x-powered-by']?.includes('Next.js')) techs.push('Next.js');
        if (headers['x-powered-by']?.includes('PHP')) techs.push('PHP');
        if (headers['x-powered-by']?.includes('ASP.NET')) techs.push('ASP.NET');
        if (headers['x-vercel-id']) techs.push('Vercel');
        if (headers['x-amz-cf-id']) techs.push('AWS CloudFront');
        if (headers['x-generator']) techs.push(headers['x-generator']);
        if (headers['x-drupal-cache']) techs.push('Drupal');

        resolve({
          url: targetUrl,
          status: res.statusCode,
          response_time_ms: responseTime,
          headers,
          security: { checks: securityChecks, score, missing },
          cookies: cookieAnalysis,
          info_leaks: leaks,
          technologies: techs,
          timestamp: new Date().toISOString(),
        });
      }
    );

    const startTime = Date.now();

    req.on('error', (err) => reject(new Error(`Request failed: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    });

    req.end();
  });
}

/**
 * Sensitive file detection — check for commonly exposed files.
 * @param {string} baseUrl
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
async function detectExposedFiles(baseUrl, opts = {}) {
  const sensitivePaths = [
    '.env',
    '.git/config',
    '.git/HEAD',
    '.htaccess',
    '.DS_Store',
    'wp-config.php',
    'wp-login.php',
    'administrator/',
    'phpmyadmin/',
    'admin/',
    'api/',
    'api/v1/',
    'api/v2/',
    'graphql',
    '.well-known/security.txt',
    'robots.txt',
    'sitemap.xml',
    'crossdomain.xml',
    'server-status',
    'server-info',
    'backup.sql',
    'dump.sql',
    'database.sql',
    'config.php',
    'web.config',
    'package.json',
    'composer.json',
    'debug',
    'trace',
    'elmah.axd',
    'swagger.json',
    'openapi.json',
    'api-docs',
    '.svn/entries',
    'CVS/Entries',
    '.vscode/settings.json',
    '.idea/workspace.xml',
  ];

  const timeout = opts.timeout || 5000;
  const concurrency = opts.concurrency || 5;
  const found = [];
  const notFound = [];

  async function checkPath(p) {
    const url = `${baseUrl.replace(/\/$/, '')}/${p}`;
    return new Promise((resolve) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        resolve({ path: p, status: 'error' });
        return;
      }

      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.request(
        parsedUrl,
        {
          method: 'HEAD',
          timeout,
          headers: { 'User-Agent': 'RedOps/2.0' },
          rejectUnauthorized: false,
        },
        (res) => {
          resolve({
            path: p,
            url,
            status: res.statusCode,
            content_type: res.headers['content-type'] || null,
            content_length: res.headers['content-length'] || null,
          });
        }
      );

      req.on('error', () => resolve({ path: p, status: 'error' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ path: p, status: 'timeout' });
      });
      req.end();
    });
  }

  for (let i = 0; i < sensitivePaths.length; i += concurrency) {
    const batch = sensitivePaths.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(checkPath));
    results.forEach((r) => {
      if (r.status >= 200 && r.status < 400) {
        found.push(r);
      } else {
        notFound.push(r.path);
      }
    });
  }

  return {
    base_url: baseUrl,
    checked: sensitivePaths.length,
    found,
    not_found_count: notFound.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * WHOIS lookup via RDAP (Registration Data Access Protocol).
 * @param {string} domain
 * @returns {Promise<Object>}
 */
async function whoisRdap(domain) {
  return new Promise((resolve, reject) => {
    const url = `https://rdap.org/domain/${domain}`;

    https.get(
      url,
      {
        headers: { 'User-Agent': 'RedOps/2.0' },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({
              domain,
              handle: data.handle,
              name: data.ldhName,
              status: data.status,
              registrar: data.entities
                ?.find((e) => e.roles?.includes('registrar'))
                ?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || null,
              events: data.events?.map((e) => ({ action: e.eventAction, date: e.eventDate })) || [],
              nameservers: data.nameservers?.map((ns) => ns.ldhName) || [],
              raw_available: true,
              timestamp: new Date().toISOString(),
            });
          } catch {
            resolve({ domain, error: 'Failed to parse RDAP response', timestamp: new Date().toISOString() });
          }
        });
      }
    ).on('error', (err) => {
      resolve({ domain, error: err.message, timestamp: new Date().toISOString() });
    });
  });
}

/**
 * Common port list for scanning.
 */
const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995,
  1433, 1521, 2049, 2375, 2376, 3306, 3389, 5432, 5900, 6379, 8000,
  8080, 8443, 8888, 9090, 9200, 9300, 27017, 27018,
];

/**
 * Web port list (focused on web services).
 */
const WEB_PORTS = [80, 443, 8000, 8080, 8443, 8888, 9090, 3000, 3001, 4200, 5000, 5173];

module.exports = {
  RateLimiter,
  resolveDns,
  scanPorts,
  analyzeSsl,
  analyzeHeaders,
  detectExposedFiles,
  whoisRdap,
  COMMON_PORTS,
  WEB_PORTS,
};
