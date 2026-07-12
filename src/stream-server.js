import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { EdiSource } from './edi-source.js';
import { StationWorker } from './station-worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configArg = process.argv.indexOf('--config');
const configPath = configArg >= 0 ? process.argv[configArg + 1] : process.env.CONFIG ?? path.resolve(__dirname, '../config.json');
const { config, resolvedPath } = loadConfig(configPath);

const log = {
  info: (message) => console.log(`${new Date().toISOString()} INFO  ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ERROR ${message}`)
};

function secureEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function writeCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
}

function checkAuth(req, res) {
  if (!config.auth.enabled) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DAB stream"' });
    res.end('Authentication required');
    return false;
  }

  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch {}
  const separator = decoded.indexOf(':');
  const username = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (!secureEqual(username, config.auth.username) || !secureEqual(password, config.auth.password)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DAB stream"' });
    res.end('Invalid credentials');
    return false;
  }
  return true;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  writeCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, status, body) {
  writeCors(res);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function streamHeaders(worker) {
  return {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'icy-name': worker.station.name,
    'icy-br': String(parseInt(config.audio.bitrate, 10) || 128),
    'Access-Control-Allow-Origin': '*'
  };
}

function stationFromPath(pathname) {
  if (pathname === '/stream.mp3' && defaultStationId) {
    return defaultStationId;
  }

  const streamMatch = pathname.match(/^\/stream\/([a-zA-Z0-9_-]+)\.mp3$/);
  if (streamMatch) return streamMatch[1];

  const shortMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)\.mp3$/);
  if (shortMatch) return shortMatch[1];

  return null;
}

log.info(`konfigurace: ${resolvedPath}`);
const streamStations = config.stream.stationIndex === null
  ? config.stations
  : [config.stations[config.stream.stationIndex]];
const defaultStationId = config.stream.stationIndex === null
  ? (config.stations.length === 1 ? config.stations[0].id : null)
  : config.stations[config.stream.stationIndex].id;
const source = new EdiSource(config.edi, log);
const workers = new Map();
for (const station of streamStations) {
  const worker = new StationWorker(station, source, config, log);
  workers.set(station.id, worker);
  worker.start();
}
source.start();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  writeCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname !== '/healthz' && !checkAuth(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/healthz') {
    const sourceOk = source.status().connected;
    const stationOk = [...workers.values()].some((worker) => worker.status().state === 'streaming');
    json(res, sourceOk && stationOk ? 200 : 503, { sourceOk, stationOk });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    json(res, 200, {
      time: Date.now(),
      defaultStream: defaultStationId ? '/stream.mp3' : null,
      stationIndex: config.stream.stationIndex,
      streams: Object.fromEntries(
        [...workers.values()].map((worker) => [
          worker.station.id,
          `/stream/${worker.station.id}.mp3`
        ])
      ),
      edi: source.status(),
      stations: [...workers.values()].map((worker) => worker.status())
    });
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD')) {
    const stationId = stationFromPath(url.pathname);
    if (stationId) {
      const worker = workers.get(stationId);
      if (!worker) { text(res, 404, 'Unknown station\n'); return; }

      res.writeHead(200, streamHeaders(worker));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      res.flushHeaders();
      worker.addClient(res);
      const cleanup = () => worker.removeClient(res);
      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const lines = [
      'DAB MP3 stream server',
      '',
      ...streamStations.map((station) => `${station.name}: /stream/${station.id}.mp3`),
      '',
      defaultStationId ? `Default stream: /stream.mp3` : null,
      'Status: /status',
      'Health: /healthz'
    ].filter((line) => line !== null);
    text(res, 200, `${lines.join('\n')}\n`);
    return;
  }

  text(res, 404, 'Not found\n');
});

server.on('clientError', (error, socket) => {
  log.error(`HTTP client error: ${error.message}`);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(config.listen.port, config.listen.host, () => {
  const streamPath = defaultStationId ? '/stream.mp3' : '/stream/ID.mp3';
  log.info(`MP3 stream posloucha na http://${config.listen.host}:${config.listen.port}${streamPath}`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`ukonceni po ${signal}`);
  server.close();
  source.stop();
  await Promise.all([...workers.values()].map((worker) => worker.shutdown()));
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
