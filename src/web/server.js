'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { Chatbot } = require('./chatbot');
const { Logger } = require('../utils/logger');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * RedOps Web Server — serves the chatbot UI and handles API requests.
 */
class WebServer {
  constructor(opts = {}) {
    this.port = opts.port || 3000;
    this.host = opts.host || '0.0.0.0';
    this.chatbot = new Chatbot({
      dataDir: opts.dataDir,
      verbose: opts.verbose,
    });
    this.logger = new Logger('WebServer', opts.verbose ? 0 : 1);
    this.publicDir = path.join(__dirname, 'public');
    this.server = null;
    this.sseClients = new Set();
  }

  /**
   * Start the web server.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.logger.error(`Port ${this.port} is in use. Try --port ${this.port + 1}`);
        }
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this.logger.info(`RedOps Web Server running at http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server.
   */
  stop() {
    if (this.server) {
      this.sseClients.forEach((res) => res.end());
      this.sseClients.clear();
      this.server.close();
    }
  }

  /**
   * Handle incoming HTTP requests.
   * @private
   */
  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API Routes
    if (pathname === '/api/chat' && req.method === 'POST') {
      return this._handleChat(req, res);
    }

    if (pathname === '/api/stream' && req.method === 'GET') {
      return this._handleSSE(req, res);
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      return this._handleStatus(req, res);
    }

    if (pathname === '/api/targets' && req.method === 'GET') {
      return this._handleTargets(req, res);
    }

    if (pathname === '/api/export' && req.method === 'GET') {
      return this._handleExport(req, res);
    }

    // Static files
    return this._serveStatic(pathname, res);
  }

  /**
   * Handle chat message via POST.
   * @private
   */
  async _handleChat(req, res) {
    try {
      const body = await this._readBody(req);
      const { message, session_id } = JSON.parse(body);

      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message is required' }));
        return;
      }

      if (message.length > 2000) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message too long (max 2000 chars)' }));
        return;
      }

      const response = await this.chatbot.processMessage(message, session_id || 'default');

      // Broadcast to SSE clients
      this._broadcast({ type: 'chat_response', ...response });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      this.logger.error(`Chat error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
    }
  }

  /**
   * Handle Server-Sent Events connection.
   * @private
   */
  _handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write('data: {"type":"connected","message":"Connected to RedOps"}\n\n');

    this.sseClients.add(res);
    this.logger.info(`SSE client connected (${this.sseClients.size} total)`);

    req.on('close', () => {
      this.sseClients.delete(res);
      this.logger.info(`SSE client disconnected (${this.sseClients.size} total)`);
    });
  }

  /**
   * Handle status request.
   * @private
   */
  _handleStatus(req, res) {
    const targets = this.chatbot.redops.getTargets();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version: '2.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      targets: targets.length,
      sse_clients: this.sseClients.size,
    }));
  }

  /**
   * Handle targets list request.
   * @private
   */
  _handleTargets(req, res) {
    const targets = this.chatbot.redops.getTargets();
    const enriched = targets.map((t) => ({
      ...t,
      summary: this.chatbot.redops.getRiskSummary(t.domain),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(enriched));
  }

  /**
   * Handle data export request.
   * @private
   */
  _handleExport(req, res) {
    const data = this.chatbot.redops.exportAll();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="redops-export-${Date.now()}.json"`,
    });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Serve static files.
   * @private
   */
  _serveStatic(pathname, res) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(this.publicDir, filePath);

    // Prevent directory traversal
    if (!filePath.startsWith(this.publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(500);
          res.end('Server Error');
        }
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

  /**
   * Broadcast event to all SSE clients.
   * @private
   */
  _broadcast(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    this.sseClients.forEach((client) => {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    });
  }

  /**
   * Read request body as string.
   * @private
   */
  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}

module.exports = { WebServer };
