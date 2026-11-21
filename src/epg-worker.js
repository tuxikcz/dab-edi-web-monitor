import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One decoder subscribes to the same source as all audio workers.
export class EpgWorker {
  constructor(source, config, log = console) {
    this.source = source;
    this.config = config;
    this.log = log;
    this.running = false;
    this.cache = null;
    this.updatedAt = null;
    this.error = null;
    this.onData = chunk => this.feed(chunk);
    this.onDisconnect = () => this.restart();
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dab-probe-epg-'));
    this.file = path.join(this.dir, 'guide.json');
    this.source.on('data', this.onData);
    this.source.on('disconnected', this.onDisconnect);
    this.launch();
    this.poll = setInterval(() => this.read(), 1000);
    this.poll.unref();
  }
  launch() {
    if (!this.running) return;
    const child = spawn(this.config.binaries.dablin, ['-f', this.config.edi.format, '-I', '--epg-json', this.file], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.on('error', error => { this.error = error.message; });
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      if (!this.running && this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
      this.child = null;
      this.error = `DABlin EPG: code=${code} signal=${signal}`;
      if (this.running) {
        this.timer = setTimeout(() => this.launch(), this.config.watchdog.restartDelayMs);
        this.timer.unref();
      }
    });
  }
  feed(chunk) {
    const input = this.child?.stdin;
    if (!input?.writable) return;
    if (input.writableLength + chunk.length > this.config.watchdog.maxInputBufferBytes) {
      this.error = 'EPG input buffer full';
      this.restart();
      return;
    }
    input.write(chunk);
  }
  restart() {
    if (!this.child || this.child.killed) return;
    const child = this.child;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), this.config.watchdog.killTimeoutMs);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
  read() {
    try {
      const stat = fs.statSync(this.file);
      if (stat.size > 8 * 1024 * 1024) throw new Error('EPG exceeds size limit');
      if (stat.mtimeMs === this.lastMtime) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data.services) || !Array.isArray(data.programmes)) throw new Error('Invalid EPG');
      this.cache = data;
      this.updatedAt = Date.now();
      this.lastMtime = stat.mtimeMs;
      this.error = null;
    } catch (error) { if (error.code !== 'ENOENT') this.error = error.message; }
  }
  status() { return { updatedAt: this.updatedAt, error: this.error, guide: this.cache }; }
  stop() {
    this.running = false;
    clearInterval(this.poll);
    clearTimeout(this.timer);
    this.source.off('data', this.onData);
    this.source.off('disconnected', this.onDisconnect);
    if (this.child) {
      const child = this.child;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), this.config.watchdog.killTimeoutMs);
      timer.unref();
      child.once('close', () => clearTimeout(timer));
    } else if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
