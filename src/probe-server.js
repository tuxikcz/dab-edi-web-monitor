import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { EdiSource } from './edi-source.js';
import { StationWorker } from './station-worker.js';
import { discoverServices } from './service-discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const configArg = process.argv.indexOf('--config');
const configPath = configArg >= 0 ? process.argv[configArg + 1] : process.env.CONFIG ?? path.resolve(__dirname, '../config.json');
const { config, resolvedPath } = loadConfig(configPath);

const listenHost = process.env.PROBE_HOST ?? config.listen.host;
const listenPort = Number.parseInt(process.env.PROBE_PORT ?? '8090', 10);
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
let activeService = null;
let stoppingPlayback = Promise.resolve();

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
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw new Error('Prilis velky pozadavek');
  }
  return body ? JSON.parse(body) : {};
}

function staticFile(res, relativePath) {
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

function parseProbeRequest(input) {
  const host = String(input.host ?? '').trim();
  const port = Number.parseInt(input.port, 10);
  const format = String(input.format ?? 'edi').trim();
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

async function stopPlayback() {
  const currentWorker = worker;
  const currentSource = source;
  worker = null;
  source = null;
  activeService = null;
  if (currentSource) currentSource.stop();
  if (currentWorker) await currentWorker.shutdown();
}

async function replacePlayback(service) {
  stoppingPlayback = stoppingPlayback.then(stopPlayback, stopPlayback);
  await stoppingPlayback;

  const station = {
    id: 'probe',
    name: serviceName(service),
    selector: { type: 'sid', value: service.sid },
    discoveredService: service
  };
  source = new EdiSource(probe.edi, log);
  worker = new StationWorker(station, source, config, log);
  activeService = service;
  worker.start();
  source.start();
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

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/probe.html')) {
      staticFile(res, 'probe.html');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, statusPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/probe') {
      const edi = parseProbeRequest(await readJson(req));
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
