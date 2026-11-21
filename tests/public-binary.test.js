import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('public preflight requires the managed DABlin and keeps old configurations intact', () => {
  const parent = path.resolve('build');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'preflight-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync('src/config.js', path.join(dir, 'src/config.js'));
    fs.copyFileSync('distribution/scripts/check-public-config.js', path.join(dir, 'scripts/check-public-config.js'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    const config = JSON.parse(fs.readFileSync('distribution/config.example.json'));
    config.edi.host = 'example.invalid';
    const configPath = path.join(dir, 'config.json');
    const check = () => spawnSync(process.execPath, [path.join(dir, 'scripts/check-public-config.js'), configPath], { encoding: 'utf8' });
    fs.writeFileSync(configPath, JSON.stringify(config));
    assert.equal(check().status, 0);
    config.binaries.dablin = '/usr/local/bin/dablin';
    const original = JSON.stringify(config);
    fs.writeFileSync(configPath, original);
    const result = check();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\/opt\/dab-probe\/bin\/dablin/);
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installer builds from this checkout and checks EPG diagnostics and PAD flags', () => {
  const script = fs.readFileSync('distribution/install.sh', 'utf8');
  assert.match(script, /DABLIN_BUILD_DIR="\$\(pwd\)\/build\/dablin" \.\/scripts\/build-dablin\.sh/);
  assert.match(script, /--epg-diagnostics/);
  assert.match(script, /--epg-json/);
  assert.match(script, / -j /);
  assert.match(script, / -J /);
  assert.match(script, /\/opt\/dab-probe\/bin\/dablin/);
});
