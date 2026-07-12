import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { EdiSource } from './edi-source.js';
import { StationWorker } from './station-worker.js';
import { resolveServiceIndexSelectors } from './service-discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
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

function checkAuth(req, res) {
  if (!config.auth.enabled) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DAB monitor"' });
    res.end('Authentication required');
    return false;
  }

  let decoded = '';
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch {}
  const separator = decoded.indexOf(':');
  const username = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (!secureEqual(username, config.auth.username) || !secureEqual(password, config.auth.password)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DAB monitor"' });
    res.end('Invalid credentials');
    return false;
  }
  return true;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
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
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml'
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

log.info(`konfigurace: ${resolvedPath}`);
const stations = await resolveServiceIndexSelectors(config, config.stations, log);
const source = new EdiSource(config.edi, log);
const workers = new Map();
for (const station of stations) {
  const worker = new StationWorker(station, source, config, log);
  workers.set(station.id, worker);
  worker.start();
}
source.start();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname !== '/healthz' && !checkAuth(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/healthz') {
    const sourceOk = source.status().connected;
    const stationOk = [...workers.values()].some((worker) => worker.status().state === 'streaming');
    json(res, sourceOk && stationOk ? 200 : 503, { sourceOk, stationOk });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    json(res, 200, {
      time: Date.now(),
      ui: config.ui,
      edi: source.status(),
      stations: [...workers.values()].map((worker) => worker.status())
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/stations') {
    json(res, 200, stations.map(({ id, name, selector }) => ({ id, name, selector })));
    return;
  }

  const restartMatch = url.pathname.match(/^\/api\/restart\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && restartMatch) {
    const worker = workers.get(restartMatch[1]);
    if (!worker) { json(res, 404, { error: 'Stanice nenalezena' }); return; }
    worker.restart('rucni restart z webu');
    json(res, 202, { ok: true });
    return;
  }

  const slideMatch = url.pathname.match(/^\/api\/slide\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && slideMatch) {
    const worker = workers.get(slideMatch[1]);
    const filename = worker?.metadataSlideFile();
    if (!worker || !filename) { res.writeHead(404); res.end('No slide'); return; }

    let stat;
    try { stat = fs.statSync(filename); } catch {
      res.writeHead(404); res.end('No slide'); return;
    }
    if (!stat.isFile()) { res.writeHead(404); res.end('No slide'); return; }

    res.writeHead(200, {
      'Content-Type': slideContentType(filename),
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filename).pipe(res);
    return;
  }

  const streamMatch = url.pathname.match(/^\/stream\/([a-zA-Z0-9_-]+)\.mp3$/);
  if (req.method === 'GET' && streamMatch) {
    const worker = workers.get(streamMatch[1]);
    if (!worker) { res.writeHead(404); res.end('Unknown station'); return; }

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'icy-name': worker.station.name,
      'icy-br': String(parseInt(config.audio.bitrate, 10) || 128)
    });
    res.flushHeaders();
    worker.addClient(res);
    const cleanup = () => worker.removeClient(res);
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    staticFile(res, 'index.html');
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/')) {
    staticFile(res, url.pathname.slice(1));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('clientError', (error, socket) => {
  log.error(`HTTP client error: ${error.message}`);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(config.listen.port, config.listen.host, () => {
  log.info(`web posloucha na http://${config.listen.host}:${config.listen.port}/`);
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
