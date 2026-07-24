'use strict';

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

/**
 * Simple structured logger for RedOps.
 */
class Logger {
  /**
   * @param {string} [context] - Logger context/module name
   * @param {number} [level] - Minimum log level
   */
  constructor(context = 'RedOps', level = LogLevel.INFO) {
    this.context = context;
    this.level = level;
    this.history = [];
  }

  _log(level, levelName, message, data) {
    if (level < this.level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      context: this.context,
      message,
      data: data || undefined,
    };

    this.history.push(entry);

    const prefix = `[${entry.timestamp}] [${levelName}] [${this.context}]`;

    switch (levelName) {
      case 'ERROR':
        console.error(`${prefix} ${message}`, data || '');
        break;
      case 'WARN':
        console.warn(`${prefix} ${message}`, data || '');
        break;
      case 'DEBUG':
        console.debug(`${prefix} ${message}`, data || '');
        break;
      default:
        console.log(`${prefix} ${message}`, data || '');
    }
  }

  debug(message, data) {
    this._log(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  info(message, data) {
    this._log(LogLevel.INFO, 'INFO', message, data);
  }

  warn(message, data) {
    this._log(LogLevel.WARN, 'WARN', message, data);
  }

  error(message, data) {
    this._log(LogLevel.ERROR, 'ERROR', message, data);
  }

  /**
   * Get recent log history.
   * @param {number} [limit]
   * @returns {Object[]}
   */
  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }
}

module.exports = { Logger, LogLevel };
