'use strict';

/**
 * RedOps Safety Guard — blocks commands that could damage the system/VPS.
 * All user input passes through here before execution.
 */

// Dangerous patterns that are ALWAYS blocked
const BLOCKED_PATTERNS = [
  // Filesystem destruction
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)*\//i,
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)*\//i,
  /\brm\s+-rf\b/i,
  /\brm\s+-fr\b/i,
  /\brmdir\b/i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=\/dev\//i,
  /\bshred\b/i,

  // System modification
  /\bchmod\s+777\s+\//i,
  /\bchown\s+.*\s+\/(etc|usr|bin|sbin|lib|boot|root)/i,
  /\bpasswd\b/i,
  /\buserdel\b/i,
  /\busermod\b/i,
  /\bvisudo\b/i,
  /\bsystemctl\s+(stop|disable|mask|reboot|poweroff)/i,
  /\bservice\s+\w+\s+stop/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,
  /\binit\s+[06]\b/i,

  // Network destruction
  /\biptables\s+-F\b/i,
  /\biptables\s+.*DROP\b/i,
  /\bufw\s+disable\b/i,
  /\bfirewall-cmd\s+.*--remove/i,

  // Package removal
  /\bapt(-get)?\s+(remove|purge|autoremove)\b/i,
  /\byum\s+remove\b/i,
  /\bdnf\s+remove\b/i,
  /\bnpm\s+uninstall\s+-g\b/i,
  /\bpip\s+uninstall\b/i,

  // Database destruction
  /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\s+\w+\s*(;|$)/i,
  /\bmysql.*-e\s+.*drop/i,
  /\bdropdb\b/i,

  // Docker destruction
  /\bdocker\s+(rm|rmi)\b/i,
  /\bdocker\s+system\s+prune/i,
  /\bdocker\s+volume\s+rm/i,

  // Process killing
  /\bkill\s+-9\b/i,
  /\bkillall\b/i,
  /\bpkill\b/i,

  // Fork bombs / resource exhaustion
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /\bwhile\s+true\b.*\bdo\b/i,

  // Credential theft
  /\bcat\s+\/etc\/shadow\b/i,
  /\bcat\s+\/etc\/passwd\b/i,
  /\bcat\s+.*\.ssh\/id_/i,
  /\bcat\s+.*\.env\b/i,

  // Reverse shells
  /\bnc\s+-[a-zA-Z]*l/i,
  /\bncat\s+-[a-zA-Z]*l/i,
  /\bbash\s+-i\s+>&/i,
  /\bpython.*socket/i,
  /\b\/dev\/tcp\//i,

  // Pivoting to other systems (not authorized)
  /\bssh\s+\w+@/i,
  /\bscp\s+/i,
  /\brsync\s+/i,
  /\bcurl.*\|\s*(bash|sh)\b/i,
  /\bwget.*\|\s*(bash|sh)\b/i,

  // Git credential theft
  /\bgit\s+.*credential/i,
  /\bgit\s+config.*password/i,

  // Arbitrary shell execution
  /\beval\s+/i,
  /\bexec\s+/i,
  /\$\(/,
  /`.*`/,
];

// Dangerous keywords that require extra scrutiny
const BLOCKED_KEYWORDS = [
  'rm -rf /',
  'format c:',
  'del /f /s /q',
  ':(){ :|:& };:',
  '> /dev/sda',
  'mkfs.ext4',
  'dd if=/dev/zero of=/dev/sda',
  'chmod -R 777 /',
];

/**
 * Check if a command is safe to execute.
 * @param {string} input - Raw user input
 * @returns {{ safe: boolean, reason?: string, blocked_pattern?: string }}
 */
function checkSafety(input) {
  const normalized = input.trim().toLowerCase();

  // Check blocked keywords first (exact match)
  for (const keyword of BLOCKED_KEYWORDS) {
    if (normalized.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        reason: `Blocked: dangerous command detected "${keyword}"`,
        blocked_pattern: keyword,
      };
    }
  }

  // Check blocked patterns (regex)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(input)) {
      return {
        safe: false,
        reason: `Blocked: potentially destructive command detected`,
        blocked_pattern: pattern.toString(),
      };
    }
  }

  // Block raw shell commands (user should use chatbot commands, not shell)
  const shellPrefixes = ['sudo ', 'su ', 'bash ', 'sh ', '/bin/', '/usr/bin/'];
  for (const prefix of shellPrefixes) {
    if (normalized.startsWith(prefix)) {
      return {
        safe: false,
        reason: `Blocked: direct shell execution not allowed. Use RedOps commands.`,
        blocked_pattern: prefix,
      };
    }
  }

  return { safe: true };
}

/**
 * Sanitize user input to prevent injection.
 * @param {string} input
 * @returns {string}
 */
function sanitize(input) {
  return input
    .replace(/[;&|`$(){}]/g, '') // Remove shell metacharacters
    .replace(/\.\.\//g, '')       // Remove path traversal
    .replace(/\n/g, ' ')          // Flatten multiline
    .trim();
}

/**
 * Get list of allowed operations for display.
 * @returns {Object}
 */
function getAllowedOperations() {
  return {
    targets: ['add', 'list', 'remove', 'info'],
    recon: ['recon', 'dns', 'headers', 'ssl', 'whois'],
    scanning: ['ports', 'files', 'scan'],
    findings: ['findings', 'add-finding', 'update-finding'],
    reports: ['report', 'prompt', 'export', 'summary'],
    system: ['help', 'status', 'targets', 'clear'],
  };
}

module.exports = {
  checkSafety,
  sanitize,
  getAllowedOperations,
  BLOCKED_PATTERNS_COUNT: BLOCKED_PATTERNS.length,
};
