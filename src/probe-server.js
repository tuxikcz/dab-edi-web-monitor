import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, normalizeEdiHost } from './config.js';
import { EdiSource } from './edi-source.js';
import { EpgWorker } from './epg-worker.js';
import { correctEdiFormat } from './edi-format.js';
import { StationWorker } from './station-worker.js';
import { discoverServices } from './service-discovery.js';
import { checkAuth, checkRequestOrigin } from './http-safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const configArg = process.argv.indexOf('--config');
const configPath = configArg >= 0 ? process.argv[configArg + 1] : process.env.CONFIG ?? path.resolve(__dirname, '../config.json');
const { config, resolvedPath } = loadConfig(configPath);

const listenHost = process.env.PROBE_HOST ?? config.listen.host;
const listenPort = Number.parseInt(process.env.PROBE_PORT ?? config.probe?.port ?? '8090', 10);
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  throw new Error('PROBE_PORT musi byt cislo 1 az 65535');
}

const log = {
  info: (message) => console.log(`${new Date().toISOString()} INFO  ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ERROR ${message}`)
};

let probe = {
  edi: null,
  services: [],
  discoveredAt: null,
  error: null
};
let source = null;
let worker = null;
let epg = null;
let activeService = null;
let playbackChange = Promise.resolve();
let controlBusy = false;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  let body = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Prilis velky pozadavek');
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function staticFile(res, relativePath) {
  if (!['probe.html', 'probe.js', 'epg-guide.js', 'style.css'].includes(relativePath)) { res.writeHead(404); res.end('Not found'); return; }
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filename = path.join(publicDir, safePath);
  if (!filename.startsWith(publicDir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let data;
  try { data = fs.readFileSync(filename); } catch {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filename);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  };
  res.writeHead(200, {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-store' : 'public, max-age=300'
  });
  res.end(data);
}

function slideContentType(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

function parseProbeRequest(input) {
  const host = normalizeEdiHost(input.host);
  const port = Number.parseInt(input.port, 10);
  const format = String(input.format ?? 'edi').trim().toLowerCase();
  const discoverSeconds = Number.parseInt(input.discoverSeconds ?? config.stream.discoverSeconds ?? 8, 10);

  if (!host) throw new Error('Host je povinny');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port musi byt cislo 1 az 65535');
  if (!['edi', 'eti'].includes(format)) throw new Error('Format musi byt edi nebo eti');
  if (!Number.isInteger(discoverSeconds) || discoverSeconds < 1 || discoverSeconds > 60) {
    throw new Error('Discovery musi byt 1 az 60 sekund');
  }

  return {
    host,
    port,
    format,
    connectTimeoutMs: config.edi.connectTimeoutMs,
    dataTimeoutMs: config.edi.dataTimeoutMs,
    reconnectMinMs: config.edi.reconnectMinMs,
    reconnectMaxMs: config.edi.reconnectMaxMs,
    discoverSeconds
  };
}

function serviceName(service) {
  return service?.label || service?.shortLabel || service?.sid || 'probe';
}

function orderedServices(services) {
  return services.toSorted((left, right) => {
    if (left.subChannelId !== null && right.subChannelId !== null) {
      return left.subChannelId - right.subChannelId;
    }
    if (left.subChannelId !== null) return -1;
    if (right.subChannelId !== null) return 1;
    return String(left.sid).localeCompare(String(right.sid));
  });
}

async function correctProbeFormat(edi) {
  return await correctEdiFormat(edi, log, 'probe');
}

async function stopPlayback() {
  const currentWorker = worker;
  const currentSource = source;
  if (epg) epg.stop();
  epg = null;
  worker = null;
  source = null;
  activeService = null;
  if (currentSource) currentSource.stop();
  if (currentWorker) await currentWorker.shutdown();
}

function replacePlayback(service) {
  const change = playbackChange.then(() => doReplacePlayback(service));
  playbackChange = change.catch(() => {});
  return change;
}

async function doReplacePlayback(service) {
  if (worker) await worker.shutdown();
  worker = null;

  const station = {
    id: 'probe',
    name: serviceName(service),
    selector: { type: 'sid', value: service.sid },
    discoveredService: service
  };
  const workerConfig = {
    ...config,
    edi: probe.edi
  };
  if (!source) {
    source = new EdiSource(probe.edi, log);
    if (config.epg?.enabled !== false) {
      epg = new EpgWorker(source, workerConfig, log);
      epg.start();
    }
    source.start();
  }
  worker = new StationWorker(station, source, workerConfig, log);
  activeService = service;
  worker.start();
}

function statusPayload() {
  return {
    time: Date.now(),
    ui: config.ui,
    defaults: {
      host: config.edi.host,
      port: config.edi.port,
      format: config.edi.format,
      discoverSeconds: config.stream.discoverSeconds
    },
    probe,
    stream: worker ? '/stream/probe.mp3' : null,
    activeService,
    edi: source?.status() ?? null,
    station: worker?.status() ?? null
  };
}

log.info(`konfigurace: ${resolvedPath}`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  let control = false;
  try {
    if (!checkAuth(req, res, config) || !checkRequestOrigin(req, res)) return;
    if (req.method === 'POST' && ['/api/probe', '/api/play', '/api/stop'].includes(url.pathname)) {
      if (controlBusy) { json(res, 409, { error: 'Request in progress' }); return; }
      control = controlBusy = true;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/probe.html')) {
      staticFile(res, 'probe.html');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/epg') {
      json(res, 200, epg?.status() ?? { updatedAt: null, error: null, guide: null });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, statusPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/probe') {
      const edi = await correctProbeFormat(parseProbeRequest(await readJson(req)));
      await stopPlayback();
      const discoveryConfig = {
        ...config,
        edi,
        stream: { ...config.stream, discoverSeconds: edi.discoverSeconds }
      };
      probe = {
        edi,
        services: [],
        discoveredAt: null,
        error: null
      };
      const services = orderedServices(await discoverServices(discoveryConfig, log, { seconds: edi.discoverSeconds }));
      probe = {
        edi,
        services,
        discoveredAt: Date.now(),
        error: services.length === 0 ? 'Discovery nenasel zadne audio sluzby' : null
      };
      if (services.length) {
        source = new EdiSource(edi, log);
        if (config.epg?.enabled !== false) {
          epg = new EpgWorker(source, discoveryConfig, log);
          epg.start();
        }
        source.start();
      }
      json(res, services.length === 0 ? 404 : 200, statusPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/play') {
      const input = await readJson(req);
      const sid = String(input.sid ?? '').trim();
      const service = probe.services.find((item) => item.sid === sid);
      if (!probe.edi || !service) {
        json(res, 404, { error: 'Sluzba nebyla nalezena. Nejdrive spustte discovery.' });
        return;
      }
      await replacePlayback(service);
      json(res, 202, statusPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      await stopPlayback();
      json(res, 200, statusPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/slide/probe') {
      const clientWorker = worker;
      const filename = clientWorker?.metadataSlideFile();
      if (!clientWorker || !filename) { res.writeHead(404); res.end('No slide'); return; }

      let stat;
      try { stat = fs.statSync(filename); } catch {
        res.writeHead(404); res.end('No slide'); return;
      }
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) { res.writeHead(404); res.end('No slide'); return; }

      res.writeHead(200, {
        'Content-Type': slideContentType(filename),
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filename).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stream/probe.mp3') {
      const clientWorker = worker;
      if (!clientWorker) { res.writeHead(404); res.end('No active probe stream'); return; }
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'icy-name': clientWorker.station.name,
        'icy-br': String(parseInt(config.audio.bitrate, 10) || 128)
      });
      res.flushHeaders();
      clientWorker.addClient(res);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clientWorker.removeClient(res);
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      staticFile(res, url.pathname.slice(1));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    log.error(`[probe] ${error.stack ?? error.message}`);
    json(res, 500, { error: error.message });
  } finally {
    if (control) controlBusy = false;
  }
});

server.listen(listenPort, listenHost, () => {
  log.info(`probe web posloucha na http://${listenHost}:${listenPort}/`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`ukonceni po ${signal}`);
  server.close();
  await stopPlayback();
  setTimeout(() => process.exit(0), 100).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  log.error(`uncaughtException: ${error.stack ?? error.message}`);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  log.error(`unhandledRejection: ${error?.stack ?? error}`);
  shutdown('unhandledRejection');
});
