import { timingSafeEqual } from 'node:crypto';

function equal(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
export function checkAuth(req, res, config) {
  if (!config.auth.enabled) return true;
  const header = req.headers.authorization ?? '';
  let decoded = '';
  if (header.startsWith('Basic ')) {
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch {}
  }
  const index = decoded.indexOf(':');
  const username = index < 0 ? '' : decoded.slice(0, index);
  const password = index < 0 ? '' : decoded.slice(index + 1);
  if (index < 0 || !equal(username, config.auth.username) || !equal(password, config.auth.password)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DAB PROBE"' });
    res.end('Authentication required');
    return false;
  }
  return true;
}
export function checkRequestOrigin(req, res) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) throw new Error('origin');
    } catch {
      res.writeHead(403); res.end('Forbidden'); return false;
    }
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end('Forbidden'); return false; }
  return true;
}
