'use strict';

/**
 * Passive recon module — gathers target intelligence without active probing.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Fetch HTTP headers from a target URL (passive fingerprinting).
 * @param {string} targetUrl
 * @param {Object} [opts]
 * @returns {Promise<Object>}
 */
function fetchHeaders(targetUrl, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(
      parsedUrl,
      {
        method: 'HEAD',
        timeout: opts.timeout || 10000,
        headers: {
          'User-Agent': 'RedOps-Recon/1.0 (Authorized Security Assessment)',
        },
      },
      (res) => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          url: targetUrl,
          timestamp: new Date().toISOString(),
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out for ${targetUrl}`));
    });

    req.end();
  });
}

/**
 * Analyze response headers for security posture.
 * @param {Object} headers
 * @returns {Object} Security header analysis
 */
function analyzeSecurityHeaders(headers) {
  const normalizedHeaders = {};
  Object.entries(headers).forEach(([key, val]) => {
    normalizedHeaders[key.toLowerCase()] = val;
  });

  const checks = {
    'content-security-policy': {
      present: !!normalizedHeaders['content-security-policy'],
      value: normalizedHeaders['content-security-policy'] || null,
      severity: 'medium',
    },
    'x-frame-options': {
      present: !!normalizedHeaders['x-frame-options'],
      value: normalizedHeaders['x-frame-options'] || null,
      severity: 'low',
    },
    'strict-transport-security': {
      present: !!normalizedHeaders['strict-transport-security'],
      value: normalizedHeaders['strict-transport-security'] || null,
      severity: 'high',
    },
    'x-content-type-options': {
      present: !!normalizedHeaders['x-content-type-options'] === 'nosniff',
      value: normalizedHeaders['x-content-type-options'] || null,
      severity: 'low',
    },
    'x-xss-protection': {
      present: !!normalizedHeaders['x-xss-protection'],
      value: normalizedHeaders['x-xss-protection'] || null,
      severity: 'info',
    },
    'referrer-policy': {
      present: !!normalizedHeaders['referrer-policy'],
      value: normalizedHeaders['referrer-policy'] || null,
      severity: 'low',
    },
    'permissions-policy': {
      present: !!normalizedHeaders['permissions-policy'],
      value: normalizedHeaders['permissions-policy'] || null,
      severity: 'low',
    },
  };

  const missing = Object.entries(checks)
    .filter(([, check]) => !check.present)
    .map(([header]) => header);

  const score = Math.round(
    (Object.values(checks).filter((c) => c.present).length / Object.keys(checks).length) * 100
  );

  return { checks, missing, score };
}

/**
 * Detect technology stack from headers.
 * @param {Object} headers
 * @returns {Object} Detected technologies
 */
function fingerprintTech(headers) {
  const normalizedHeaders = {};
  Object.entries(headers).forEach(([key, val]) => {
    normalizedHeaders[key.toLowerCase()] = val;
  });

  const technologies = [];

  // Server detection
  if (normalizedHeaders['server']) {
    technologies.push({ type: 'server', name: normalizedHeaders['server'] });
  }

  // X-Powered-By
  if (normalizedHeaders['x-powered-by']) {
    technologies.push({ type: 'framework', name: normalizedHeaders['x-powered-by'] });
  }

  // Cloudflare detection
  if (normalizedHeaders['cf-ray'] || normalizedHeaders['server']?.includes('cloudflare')) {
    technologies.push({ type: 'cdn_waf', name: 'Cloudflare' });
  }

  // AWS detection
  if (normalizedHeaders['x-amz-cf-id'] || normalizedHeaders['x-amz-cf-pop']) {
    technologies.push({ type: 'cdn', name: 'AWS CloudFront' });
  }

  // Vercel detection
  if (normalizedHeaders['x-vercel-id']) {
    technologies.push({ type: 'hosting', name: 'Vercel' });
  }

  // Next.js detection
  if (normalizedHeaders['x-powered-by']?.includes('Next.js')) {
    technologies.push({ type: 'framework', name: 'Next.js' });
  }

  return {
    technologies,
    server: normalizedHeaders['server'] || 'Unknown',
    powered_by: normalizedHeaders['x-powered-by'] || 'Unknown',
  };
}

module.exports = {
  fetchHeaders,
  analyzeSecurityHeaders,
  fingerprintTech,
};
