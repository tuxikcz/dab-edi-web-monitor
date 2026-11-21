import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('main service preflight requires a source and the managed DABlin without altering settings', () => {
  fs.mkdirSync('build', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('build/preflight-main-'));
  try {
    const config = JSON.parse(fs.readFileSync('config.example.json'));
    const file = path.join(dir, 'config.json');
    const run = () => { fs.writeFileSync(file, JSON.stringify(config)); return spawnSync(process.execPath, ['scripts/check-config.js', file], { encoding: 'utf8' }); };
    assert.notEqual(run().status, 0);
    config.edi.host = 'example.invalid';
    assert.equal(run().status, 0);
    config.binaries.dablin = '/usr/local/bin/dablin';
    assert.notEqual(run().status, 0);
    assert.equal(JSON.parse(fs.readFileSync(file)).binaries.dablin, '/usr/local/bin/dablin');
    config.binaries.dablin = '/opt/dab-edi-web-monitor/bin/dablin';
    config.listen.host = '0.0.0.0';
    assert.notEqual(run().status, 0);
    config.auth = { enabled: true, username: 'user', password: 'test-only' };
    assert.equal(run().status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main installer installs managed DABlin and does not activate services', () => {
  const install = fs.readFileSync('install.sh', 'utf8');
  assert.match(install, /DABLIN_BUILD_DIR="\$\(pwd\)\/build\/dablin"/);
  assert.match(install, /\/opt\/dab-edi-web-monitor\/bin\/dablin/);
  assert.match(install, /if \[ ! -f \/etc\/dab-edi-web-monitor\/config\.json \]/);
  assert.doesNotMatch(install, /^systemctl\s+(?:enable|start|restart)\b/m);
  const build = fs.readFileSync('scripts/build-dablin.sh', 'utf8');
  assert.match(build, /-DDISABLE_SDL=1/);
  assert.match(build, /-DDISABLE_GTK=1/);
  for (const file of ['systemd/dab-probe.service', 'systemd/dab-edi-web-monitor.service']) {
    assert.match(fs.readFileSync(file, 'utf8'), /ExecStartPre=.*check-config\.js/);
  }
});
