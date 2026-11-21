import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EpgWorker } from '../src/epg-worker.js';

test('cache accepts complete updates and retains the last guide after invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epg-test-'));
  try {
    const worker = new EpgWorker(new EventEmitter(), {});
    worker.file = path.join(dir, 'guide.json');
    worker.read();
    assert.equal(worker.status().guide, null);
    fs.writeFileSync(worker.file, JSON.stringify({ services: [], programmes: [{ name: 'Test' }] }));
    worker.read();
    assert.equal(worker.status().guide.programmes[0].name, 'Test');
    const updated = worker.status().updatedAt;
    worker.lastMtime = undefined;
    fs.writeFileSync(worker.file, '{');
    worker.read();
    assert.equal(worker.status().guide.programmes[0].name, 'Test');
    assert.equal(worker.status().updatedAt, updated);
    assert.ok(worker.status().error);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
