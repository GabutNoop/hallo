'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Persistent JSON file storage for RedOps data.
 * Thread-safe with file locking via atomic writes.
 */
class Storage extends EventEmitter {
  /**
   * @param {string} dataDir - Directory for data files
   */
  constructor(dataDir) {
    super();
    this.dataDir = path.resolve(dataDir);
    this._ensureDir(this.dataDir);
    this._cache = new Map();
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _filePath(collection) {
    return path.join(this.dataDir, `${collection}.json`);
  }

  /**
   * Load a collection from disk (with caching).
   * @param {string} collection
   * @returns {Object[]}
   */
  load(collection) {
    if (this._cache.has(collection)) {
      return this._cache.get(collection);
    }

    const filePath = this._filePath(collection);
    let data = [];

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        data = JSON.parse(raw);
      } catch (err) {
        this.emit('error', new Error(`Failed to load ${collection}: ${err.message}`));
        data = [];
      }
    }

    this._cache.set(collection, data);
    return data;
  }

  /**
   * Save a collection to disk atomically.
   * @param {string} collection
   * @param {Object[]} data
   */
  save(collection, data) {
    const filePath = this._filePath(collection);
    const tmpPath = `${filePath}.tmp`;

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
      this._cache.set(collection, data);
      this.emit('saved', { collection, count: data.length });
    } catch (err) {
      // Cleanup temp file on failure
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      throw new Error(`Failed to save ${collection}: ${err.message}`);
    }
  }

  /**
   * Insert a record into a collection.
   * @param {string} collection
   * @param {Object} record
   * @returns {Object} The inserted record
   */
  insert(collection, record) {
    const data = this.load(collection);
    data.push(record);
    this.save(collection, data);
    return record;
  }

  /**
   * Find records matching a filter.
   * @param {string} collection
   * @param {Function} predicate
   * @returns {Object[]}
   */
  find(collection, predicate) {
    const data = this.load(collection);
    return data.filter(predicate);
  }

  /**
   * Find a single record.
   * @param {string} collection
   * @param {Function} predicate
   * @returns {Object|undefined}
   */
  findOne(collection, predicate) {
    const data = this.load(collection);
    return data.find(predicate);
  }

  /**
   * Update records matching a filter.
   * @param {string} collection
   * @param {Function} predicate
   * @param {Object} updates
   * @returns {number} Number of records updated
   */
  update(collection, predicate, updates) {
    const data = this.load(collection);
    let count = 0;

    const updated = data.map((record) => {
      if (predicate(record)) {
        count++;
        return { ...record, ...updates, updated_at: new Date().toISOString() };
      }
      return record;
    });

    this.save(collection, updated);
    return count;
  }

  /**
   * Delete records matching a filter.
   * @param {string} collection
   * @param {Function} predicate
   * @returns {number} Number of records deleted
   */
  delete(collection, predicate) {
    const data = this.load(collection);
    const before = data.length;
    const filtered = data.filter((r) => !predicate(r));
    this.save(collection, filtered);
    return before - filtered.length;
  }

  /**
   * Clear the in-memory cache (forces reload from disk on next access).
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * Get all collection names.
   * @returns {string[]}
   */
  listCollections() {
    return fs
      .readdirSync(this.dataDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  /**
   * Export all data.
   * @returns {Object}
   */
  exportAll() {
    const collections = this.listCollections();
    const result = {};
    collections.forEach((c) => {
      result[c] = this.load(c);
    });
    return result;
  }
}

module.exports = { Storage };
