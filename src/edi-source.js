import net from 'node:net';
import { EventEmitter } from 'node:events';

export class EdiSource extends EventEmitter {
  constructor(options, log = console) {
    super();
    this.options = options;
    this.log = log;
    this.socket = null;
    this.running = false;
    this.connected = false;
    this.connecting = false;
    this.connectedAt = 0;
    this.lastDataAt = 0;
    this.bytesReceived = 0;
    this.reconnects = 0;
    this.lastError = null;
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.watchdogTimer = null;
    this.reconnectDelay = options.reconnectMinMs;
    this.generation = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.watchdogTimer = setInterval(() => this.#watchdog(), 1000);
    this.watchdogTimer.unref();
    this.#connect();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.watchdogTimer);
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.watchdogTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.connecting = false;
  }

  #connect() {
    if (!this.running || this.socket || this.connecting) return;

    const generation = ++this.generation;
    this.connecting = true;
    this.lastError = null;

    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port
    });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);

    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation || this.connected) return;
      socket.destroy(new Error(`timeout spojeni po ${this.options.connectTimeoutMs} ms`));
    }, this.options.connectTimeoutMs);
    this.connectTimer.unref();

    socket.on('connect', () => {
      if (generation !== this.generation) return;
      clearTimeout(this.connectTimer);
      this.connecting = false;
      this.connected = true;
      this.connectedAt = Date.now();
      this.lastDataAt = 0;
      this.reconnectDelay = this.options.reconnectMinMs;
      this.log.info(`[EDI] spojeno ${this.options.host}:${this.options.port}`);
      this.emit('connected');
    });

    socket.on('data', (chunk) => {
      if (generation !== this.generation) return;
      this.lastDataAt = Date.now();
      this.bytesReceived += chunk.length;
      this.emit('data', chunk);
    });

    socket.on('error', (error) => {
      if (generation !== this.generation) return;
      this.lastError = error.message;
      this.log.error(`[EDI] ${error.message}`);
    });

    socket.on('close', () => {
      if (generation !== this.generation) return;
      clearTimeout(this.connectTimer);
      this.socket = null;
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      if (wasConnected) this.emit('disconnected');
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnects += 1;
    this.reconnectDelay = Math.min(
      Math.max(this.options.reconnectMinMs, this.reconnectDelay * 2),
      this.options.reconnectMaxMs
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  #watchdog() {
    if (!this.running || !this.connected || !this.socket) return;
    if (this.lastDataAt === 0) {
      if (Date.now() - this.connectedAt > this.options.dataTimeoutMs) {
        this.lastError = 'po spojeni neprisla zadna EDI data';
        this.socket.destroy(new Error(this.lastError));
      }
      return;
    }
    if (Date.now() - this.lastDataAt > this.options.dataTimeoutMs) {
      this.lastError = `EDI data timeout ${this.options.dataTimeoutMs} ms`;
      this.socket.destroy(new Error(this.lastError));
    }
  }

  status() {
    return {
      host: this.options.host,
      port: this.options.port,
      format: this.options.format ?? null,
      connected: this.connected,
      connecting: this.connecting,
      connectedAt: this.connectedAt || null,
      lastDataAt: this.lastDataAt || null,
      bytesReceived: this.bytesReceived,
      reconnects: this.reconnects,
      lastError: this.lastError
    };
  }
}
