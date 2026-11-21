import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAuth, checkRequestOrigin } from '../src/http-safety.js';
const response = () => ({ code: null, writeHead(code) { this.code = code; }, end() {} });
test('probe authentication is optional but enforces configured credentials', () => {
  const config = { auth: { enabled: true, username: 'user', password: 'secret' } };
  let res = response();
  assert.equal(checkAuth({ headers: {} }, res, config), false);
  assert.equal(res.code, 401);
  res = response();
  assert.equal(checkAuth({ headers: { authorization: `Basic ${Buffer.from('user:secret').toString('base64')}` } }, res, config), true);
  assert.equal(checkAuth({ headers: {} }, response(), { auth: { enabled: false } }), true);
});
test('cross-origin changes are rejected while same-origin and non-browser clients work', () => {
  const req = origin => ({ method: 'POST', headers: { host: 'example.test', ...(origin ? { origin } : {}) } });
  assert.equal(checkRequestOrigin(req('https://evil.test'), response()), false);
  assert.equal(checkRequestOrigin(req('https://example.test'), response()), true);
  assert.equal(checkRequestOrigin(req(), response()), true);
  assert.equal(checkRequestOrigin({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }, response()), false);
});
