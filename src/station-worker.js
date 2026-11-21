import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseServiceLabelLine } from './service-discovery.js';

function safeKillProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      console.error(`[proces ${child.pid}] nelze poslat ${signal}: ${error.message}`);
    }
  }
}

function selectorArgs(selector) {
  switch (selector.type) {
    case 'first': return ['-1'];
    case 'sid': return ['-s', selector.value];
    case 'label': return ['-l', selector.value];
    default: throw new Error(`Neznamy selector ${selector.type}`);
  }
}

export class StationWorker {
  constructor(station, source, config, log = console) {
    this.station = station;
    this.source = source;
    this.config = config;
    this.log = log;

    this.dablin = null;
    this.ffmpeg = null;
    this.runId = 0;
    this.running = false;
    this.shuttingDown = false;
    this.restartTimer = null;
    this.watchdogTimer = null;
    this.killTimers = new Set();

    this.state = 'stopped';
    this.startedAt = 0;
    this.lastPcmAt = 0;
    this.lastMp3At = 0;
    this.bytesPcm = 0;
    this.bytesMp3 = 0;
    this.restarts = 0;
    this.lastRestartReason = null;
    this.lastDablinMessage = null;
    this.lastFfmpegMessage = null;
    this.lastDablinArgs = null;
    this.currentService = {
      sid: station.discoveredService?.sid ?? (station.selector.type === 'sid' ? station.selector.value : null),
      label: station.discoveredService?.label ?? null,
      shortLabel: station.discoveredService?.shortLabel ?? null,
      subChannelId: station.discoveredService?.subChannelId ?? null,
      codec: null,
      sampleRate: null,
      channels: null,
      bitrate: null
    };
    this.currentEnsemble = {
      id: null,
      label: null,
      shortLabel: null
    };
    this.currentMetadata = {
      dynamicLabel: null,
      dlPlus: [],
      slide: null,
      slideProgress: null,
      updatedAt: null,
      slideUpdatedAt: null
    };
    this.clients = new Set();

    this.onEdiData = (chunk) => this.#pushEdi(chunk);
    this.onSourceConnected = () => {
      if (!this.running && !this.shuttingDown) this.start();
    };
    this.onSourceDisconnected = () => {
      if (this.running) this.state = 'waiting_edi';
    };
  }

  start() {
    if (this.running || this.shuttingDown) return;
    this.running = true;
    this.source.on('data', this.onEdiData);
    this.source.on('connected', this.onSourceConnected);
    this.source.on('disconnected', this.onSourceDisconnected);
    this.watchdogTimer = setInterval(
      () => this.#watchdog(),
      this.config.watchdog.checkIntervalMs
    );
    this.watchdogTimer.unref();
    this.#spawnPipeline();
  }

  async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.running = false;
    clearTimeout(this.restartTimer);
    clearInterval(this.watchdogTimer);
    this.restartTimer = null;
    this.watchdogTimer = null;
    this.source.off('data', this.onEdiData);
    this.source.off('connected', this.onSourceConnected);
    this.source.off('disconnected', this.onSourceDisconnected);
    this.#teardownProcesses();
    for (const client of this.clients) {
      try { client.end(); } catch {}
    }
    this.clients.clear();
    this.state = 'stopped';

    // Pri rucnim spusteni mimo systemd musime pockat i na nouzovy SIGKILL,
    // jinak by detached proces mohl prezit ukonceni Node.js supervisoru.
    await new Promise((resolve) => setTimeout(resolve, this.config.watchdog.killTimeoutMs + 100));
  }

  restart(reason = 'rucni restart') {
    this.#scheduleRestart(reason, true);
  }

  addClient(response) {
    this.clients.add(response);
  }

  removeClient(response) {
    this.clients.delete(response);
  }

  #spawnPipeline() {
    if (!this.running || this.shuttingDown) return;

    const runId = ++this.runId;
    this.startedAt = Date.now();
    this.lastPcmAt = 0;
    this.lastMp3At = 0;
    this.state = this.source.connected ? 'starting' : 'waiting_edi';

    const dablinArgs = [
      '-f', this.config.edi.format,
      '-I',
      '-F',
      ...selectorArgs(this.station.selector),
      '-w'
    ];
    const metadataDir = this.#metadataDir();
    if (metadataDir) {
      fs.mkdirSync(metadataDir, { recursive: true });
      dablinArgs.push('-J', metadataDir);
    }

    const ffmpegArgs = [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+nobuffer',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-f', 'wav',
      '-i', 'pipe:0',
      '-map', '0:a:0',
      '-vn',
      '-ar', String(this.config.audio.sampleRate),
      '-ac', String(this.config.audio.channels),
      '-c:a', 'libmp3lame',
      '-b:a', this.config.audio.bitrate,
      '-write_xing', '0',
      '-id3v2_version', '0',
      '-flush_packets', '1',
      '-f', 'mp3',
      'pipe:1'
    ];

    this.log.info(`[${this.station.id}] start dablin ${dablinArgs.join(' ')}`);
    this.lastDablinArgs = dablinArgs;

    const dablin = spawn(this.config.binaries.dablin, dablinArgs, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const ffmpeg = spawn(this.config.binaries.ffmpeg, ffmpegArgs, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.dablin = dablin;
    this.ffmpeg = ffmpeg;

    dablin.stdin.on('error', (error) => {
      if (runId === this.runId && error.code !== 'EPIPE') {
        this.#scheduleRestart(`dablin stdin: ${error.message}`);
      }
    });
    ffmpeg.stdin.on('error', (error) => {
      if (runId === this.runId && error.code !== 'EPIPE') {
        this.#scheduleRestart(`ffmpeg stdin: ${error.message}`);
      }
    });

    dablin.stdout.on('data', (chunk) => {
      if (runId !== this.runId) return;
      this.lastPcmAt = Date.now();
      this.bytesPcm += chunk.length;
    });

    ffmpeg.stdout.on('data', (chunk) => {
      if (runId !== this.runId) return;
      this.lastMp3At = Date.now();
      this.bytesMp3 += chunk.length;
      this.state = 'streaming';
      this.#broadcast(chunk);
    });

    this.#captureLines(dablin.stderr, runId, 'dablin');
    this.#captureLines(ffmpeg.stderr, runId, 'ffmpeg');

    dablin.on('error', (error) => {
      if (runId === this.runId) this.#scheduleRestart(`dablin spawn: ${error.message}`);
    });
    ffmpeg.on('error', (error) => {
      if (runId === this.runId) this.#scheduleRestart(`ffmpeg spawn: ${error.message}`);
    });
    dablin.on('exit', (code, signal) => {
      if (runId === this.runId) {
        this.#scheduleRestart(`dablin skoncil code=${code} signal=${signal}`);
      }
    });
    ffmpeg.on('exit', (code, signal) => {
      if (runId === this.runId) {
        this.#scheduleRestart(`ffmpeg skoncil code=${code} signal=${signal}`);
      }
    });

    dablin.stdout.pipe(ffmpeg.stdin);
  }

  #captureLines(stream, runId, sourceName) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (text) => {
      if (runId !== this.runId) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine
          .replace(/\x1b\[[0-9;]*m/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
          .trim();
        if (!line) continue;
        if (sourceName === 'dablin' && this.#capturePadMetadata(line)) continue;
        if (sourceName === 'dablin') {
          this.lastDablinMessage = line;
          this.#captureDablinMetadata(line);
        } else {
          this.lastFfmpegMessage = line;
        }
        this.log.error(`[${this.station.id}/${sourceName}] ${line}`);
      }
    });
  }

  #metadataDir() {
    if (!this.config.metadata?.enabled) return null;
    return path.join(this.config.metadata.slideDir, this.station.id);
  }

  #capturePadMetadata(line) {
    if (!line.startsWith('{')) return false;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return false;
    }

    if (event.type === 'dynamic_label') {
      this.currentMetadata.dynamicLabel = typeof event.text === 'string' ? event.text : null;
      this.currentMetadata.dlPlus = Array.isArray(event.dl_plus) ? event.dl_plus : [];
      this.currentMetadata.updatedAt = Date.now();
      return true;
    }

    if (event.type === 'slideshow_progress') {
      this.currentMetadata.slideProgress = Number.isFinite(event.fraction) ? event.fraction : null;
      return true;
    }

    if (event.type === 'slideshow') {
      this.currentMetadata.slideProgress = 1;
      this.currentMetadata.slideUpdatedAt = Date.now();
      this.currentMetadata.updatedAt = this.currentMetadata.slideUpdatedAt;
      this.currentMetadata.slide = {
        contentName: event.content_name ?? null,
        contentType: event.content_type ?? null,
        contentSubType: event.content_sub_type ?? null,
        size: Number.isFinite(event.size) ? event.size : null,
        url: `/api/slide/${encodeURIComponent(this.station.id)}?t=${this.currentMetadata.slideUpdatedAt}`,
        file: typeof event.file === 'string' ? event.file : null
      };
      return true;
    }

    return false;
  }

  #captureDablinMetadata(line) {
    const ensembleLabelMatch = line.match(/FICDecoder: EId (0x[0-9A-Fa-f]+): ensemble label '([^']*)' \('([^']*)'\)/);
    if (ensembleLabelMatch) {
      this.currentEnsemble.id = ensembleLabelMatch[1];
      this.currentEnsemble.label = ensembleLabelMatch[2];
      this.currentEnsemble.shortLabel = ensembleLabelMatch[3];
      return;
    }

    const ensembleIdMatch = line.match(/FICDecoder: EId (0x[0-9A-Fa-f]+):/);
    if (ensembleIdMatch) {
      this.currentEnsemble.id = ensembleIdMatch[1];
    }

    const playingMatch = line.match(/EnsemblePlayer: playing sub-channel\s+(\d+)/);
    if (playingMatch) {
      this.currentService.subChannelId = Number(playingMatch[1]);
      return;
    }

    const formatMatch = line.match(/EnsemblePlayer: format: ([^,]+),\s+(\d+) kHz\s+([^@]+?)\s+@\s+(\d+)\s+kBit\/s/);
    if (formatMatch) {
      this.currentService.codec = formatMatch[1].trim();
      this.currentService.sampleRate = Number(formatMatch[2]) * 1000;
      this.currentService.channels = formatMatch[3].trim();
      this.currentService.bitrate = `${formatMatch[4]} kBit/s`;
      return;
    }

    const label = parseServiceLabelLine(line);
    if (label && (!this.currentService.sid || label.sid.toLowerCase() === this.currentService.sid.toLowerCase())) {
      this.currentService.sid = label.sid;
      if (label.type === 'programme' || !this.currentService.label) {
        this.currentService.label = label.label;
        this.currentService.shortLabel = label.shortLabel;
      }
    }
  }

  #pushEdi(chunk) {
    if (!this.running || this.shuttingDown || !this.dablin?.stdin?.writable) return;

    const buffered = this.dablin.stdin.writableLength;
    if (buffered > this.config.watchdog.maxInputBufferBytes) {
      this.#scheduleRestart(`ucpany vstup dablinu: ${buffered} B`);
      return;
    }

    try {
      this.dablin.stdin.write(chunk);
    } catch (error) {
      this.#scheduleRestart(`zapis EDI do dablinu: ${error.message}`);
    }
  }

  #broadcast(chunk) {
    for (const client of this.clients) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client);
        continue;
      }
      if (client.writableLength > this.config.watchdog.maxClientBufferBytes) {
        this.log.error(`[${this.station.id}] odpojuji pomaleho weboveho klienta`);
        client.destroy();
        this.clients.delete(client);
        continue;
      }
      try {
        client.write(chunk);
      } catch {
        client.destroy();
        this.clients.delete(client);
      }
    }
  }

  #watchdog() {
    if (!this.running || this.shuttingDown) return;
    const sourceStatus = this.source.status();
    if (!sourceStatus.connected || !sourceStatus.lastDataAt) {
      this.state = 'waiting_edi';
      return;
    }

    const now = Date.now();
    if (now - this.startedAt < this.config.watchdog.startupGraceMs) return;

    if (!this.lastPcmAt || now - this.lastPcmAt > this.config.watchdog.pcmTimeoutMs) {
      this.#scheduleRestart(`PCM timeout ${this.config.watchdog.pcmTimeoutMs} ms`);
      return;
    }

    if (!this.lastMp3At || now - this.lastMp3At > this.config.watchdog.mp3TimeoutMs) {
      this.#scheduleRestart(`MP3 timeout ${this.config.watchdog.mp3TimeoutMs} ms`);
    }
  }

  #scheduleRestart(reason, immediate = false) {
    if (!this.running || this.shuttingDown || this.restartTimer) return;
    this.restarts += 1;
    this.lastRestartReason = reason;
    this.state = 'restarting';
    this.log.error(`[${this.station.id}] restart: ${reason}`);
    this.#teardownProcesses();

    const delay = immediate ? 0 : this.config.watchdog.restartDelayMs;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.#spawnPipeline();
    }, delay);
    this.restartTimer.unref();
  }

  #teardownProcesses() {
    ++this.runId;
    const dablin = this.dablin;
    const ffmpeg = this.ffmpeg;
    this.dablin = null;
    this.ffmpeg = null;

    if (dablin) {
      try { dablin.stdout.unpipe(); } catch {}
      try { dablin.stdin.destroy(); } catch {}
      try { dablin.stdout.destroy(); } catch {}
      try { dablin.stderr.destroy(); } catch {}
      safeKillProcessGroup(dablin, 'SIGTERM');
    }
    if (ffmpeg) {
      try { ffmpeg.stdin.destroy(); } catch {}
      try { ffmpeg.stdout.destroy(); } catch {}
      try { ffmpeg.stderr.destroy(); } catch {}
      safeKillProcessGroup(ffmpeg, 'SIGTERM');
    }

    if (dablin || ffmpeg) {
      const timer = setTimeout(() => {
        safeKillProcessGroup(dablin, 'SIGKILL');
        safeKillProcessGroup(ffmpeg, 'SIGKILL');
        this.killTimers.delete(timer);
      }, this.config.watchdog.killTimeoutMs);
      timer.unref();
      this.killTimers.add(timer);
    }
  }

  status() {
    return {
      id: this.station.id,
      name: this.station.name,
      selector: this.station.selector,
      state: this.state,
      startedAt: this.startedAt || null,
      lastPcmAt: this.lastPcmAt || null,
      lastMp3At: this.lastMp3At || null,
      bytesPcm: this.bytesPcm,
      bytesMp3: this.bytesMp3,
      currentService: this.currentService,
      currentEnsemble: this.currentEnsemble,
      metadata: {
        ...this.currentMetadata,
        slide: this.currentMetadata.slide ? {
          contentName: this.currentMetadata.slide.contentName,
          contentType: this.currentMetadata.slide.contentType,
          contentSubType: this.currentMetadata.slide.contentSubType,
          size: this.currentMetadata.slide.size,
          url: this.currentMetadata.slide.url
        } : null
      },
      clients: this.clients.size,
      restarts: this.restarts,
      lastRestartReason: this.lastRestartReason,
      lastDablinMessage: this.lastDablinMessage,
      lastFfmpegMessage: this.lastFfmpegMessage,
      inputFormat: this.config.edi.format,
      lastDablinArgs: this.lastDablinArgs,
      dablinPid: this.dablin?.pid ?? null,
      ffmpegPid: this.ffmpeg?.pid ?? null
    };
  }

  metadataSlideFile() {
    const filename = this.currentMetadata.slide?.file;
    const metadataDir = this.#metadataDir();
    if (!filename || !metadataDir) return null;
    try {
      const root = fs.realpathSync(metadataDir);
      const resolved = fs.realpathSync(filename);
      return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
    } catch { return null; }
  }
}
