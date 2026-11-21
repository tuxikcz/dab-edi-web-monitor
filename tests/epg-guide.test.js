import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuide, dayBounds, formatProgrammeTime, isOnAir, isStale, localDay, programmesForDay, stationsFromGuide, STALE_AFTER_MS } from '../public/epg-guide.js';

process.env.TZ = 'Europe/Prague';
const programme = (bearer, start, end, name = 'Show') => ({ bearer, start, end, name, short_description: 'Short', long_description: 'Long' });

test('bearers from programme data define stations, filter invalid entries, deduplicate and sort', () => {
  const guide = { services: [{ bearer: 'b', name: 'Radio B' }, { bearer: 'unused', name: 'Unused' }], programmes: [programme('b', '2026-03-29T01:00:00Z', '2026-03-29T02:00:00Z'), programme('a', '2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z'), programme('b', '2026-03-29T01:00:00Z', '2026-03-29T02:00:00Z'), programme('b', 'bad', 'bad')] };
  const stations = stationsFromGuide(guide);
  assert.deepEqual(stations.map(s => [s.bearer, s.name, s.programmes.length]), [['a', 'a', 1], ['b', 'Radio B', 1]]);
});

test('local day overlap covers midnight and DST days with exclusive end', () => {
  assert.equal(dayBounds('2026-03-29')[1] - dayBounds('2026-03-29')[0], 23 * 3600000);
  assert.equal(dayBounds('2026-10-25')[1] - dayBounds('2026-10-25')[0], 25 * 3600000);
  assert.equal(dayBounds('2026-02-30'), null);
  const p = stationsFromGuide({ services: [], programmes: [programme('x', '2026-03-28T22:30:00Z', '2026-03-29T00:30:00Z')] })[0].programmes;
  assert.equal(programmesForDay(p, '2026-03-28').length, 1);
  assert.equal(programmesForDay(p, '2026-03-29').length, 1);
  assert.equal(programmesForDay(p, '2026-03-30').length, 0);
  assert.notEqual(localDay(p[0].startMs), localDay(p[0].endMs));
  assert.equal(formatProgrammeTime(p[0].endMs, '2026-03-28', 'cs'), '01:30 (+1 den)');
  assert.equal(formatProgrammeTime(Date.parse('2026-10-25T00:30:00Z'), '2026-10-25', 'cs'), '02:30 ①');
  assert.equal(formatProgrammeTime(Date.parse('2026-10-25T01:30:00Z'), '2026-10-25', 'cs'), '02:30 ②');
  assert.notEqual(formatProgrammeTime(Date.parse('2026-10-25T00:30:00Z'), '2026-10-25', 'en'), formatProgrammeTime(Date.parse('2026-10-25T01:30:00Z'), '2026-10-25', 'en'));
  assert.equal(isOnAir(p[0], p[0].startMs), true);
  assert.equal(isOnAir(p[0], p[0].endMs), false);
  assert.equal(isStale(1000, 1000 + STALE_AFTER_MS - 1), false);
  assert.equal(isStale(1000, 1000 + STALE_AFTER_MS), true);
});

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.attributes = {}; this.value = ''; this.textContent = ''; this.listeners = {}; this.classes = new Set();
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  querySelector(selector) { return this.children.flatMap(child => [child, ...child.children]).find(child => `.${child.className}` === selector); }
  trigger(type) { this.listeners[type](); }
}
function fakeDocument() {
  const nodes = new Map();
  return { documentElement: { lang: 'cs' }, getElementById(id) { if (!nodes.has(id)) nodes.set(id, new FakeElement()); return nodes.get(id); }, createElement: tag => new FakeElement(tag) };
}

test('UI keeps selection and current marker independently and retains guide on failure', async () => {
  const doc = fakeDocument(), now = Date.parse('2026-03-29T00:15:00Z');
  let time = now, fail = false;
  const guide = { services: [{ bearer: 'hey', name: 'HEY' }], programmes: [programme('hey', '2026-03-29T00:00:00Z', '2026-03-29T00:30:00Z', 'First'), programme('hey', '2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', 'Second')] };
  const ui = createGuide(doc, async () => { if (fail) throw Error('offline'); return { guide, updatedAt: now }; }, () => time);
  await ui.refresh();
  const rows = doc.getElementById('epgRows');
  assert.equal(doc.getElementById('epgDay').value, '2026-03-29');
  assert.equal(doc.getElementById('epgStation').value, 'hey');
  const [first, second] = rows.children;
  assert.ok(first.classes.has('on-air'));
  second.children[2].children[0].trigger('click');
  assert.ok(second.classes.has('selected'));
  assert.ok(first.classes.has('on-air'));
  assert.deepEqual(doc.getElementById('epgDetail').children.map(node => node.textContent), ['Second', 'Short', 'Long']);
  await ui.refresh();
  assert.equal(rows.children[0], first, 'unchanged data does not rebuild rows');
  fail = true; time += STALE_AFTER_MS;
  await ui.refresh();
  assert.equal(rows.children[1], second);
  assert.ok(second.classes.has('selected'));
  assert.match(doc.getElementById('epgState').textContent, /zastaralá/);
  doc.documentElement.lang = 'de';
  await ui.refresh();
  assert.equal(doc.getElementById('epgStartHeading').textContent, 'Beginn');
  assert.match(doc.getElementById('epgState').textContent, /veraltet/);
});

test('station and day selection follow received bearers, and updates retain a matching selection', async () => {
  const doc = fakeDocument();
  const now = Date.parse('2026-05-01T10:15:00Z');
  let guide = { services: [{ bearer: 'x', name: 'X' }, { bearer: 'y', name: 'Y' }], programmes: [programme('x', '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z', 'Morning'), programme('y', '2026-05-02T10:00:00Z', '2026-05-02T11:00:00Z', '<script>')] };
  const ui = createGuide(doc, async () => ({ guide, updatedAt: now }), () => now);
  await ui.refresh();
  const select = doc.getElementById('epgStation'), day = doc.getElementById('epgDay'), rows = doc.getElementById('epgRows');
  select.value = 'y'; select.trigger('change');
  assert.equal(rows.children.length, 0);
  day.value = '2026-05-02'; day.trigger('change');
  assert.equal(rows.children.length, 1);
  rows.children[0].children[2].children[0].trigger('click');
  assert.equal(doc.getElementById('epgDetail').children[0].textContent, '<script>');
  guide = { ...guide, programmes: guide.programmes.map(p => p.bearer === 'y' ? { ...p, long_description: 'New details' } : p) };
  await ui.refresh();
  assert.equal(select.value, 'y');
  assert.ok(rows.children[0].classes.has('selected'));
  assert.equal(doc.getElementById('epgDetail').children[2].textContent, 'New details');
  doc.documentElement.lang = 'en';
  await ui.refresh();
  assert.equal(doc.getElementById('epgDayLabel').textContent, 'Day');
  assert.ok(rows.children[0].classes.has('selected'));
});

test('current marker advances independently of selected programme', async () => {
  const doc = fakeDocument();
  let now = Date.parse('2026-05-01T10:15:00Z');
  const guide = { services: [], programmes: [programme('a', '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', 'First'), programme('a', '2026-05-01T10:30:00Z', '2026-05-01T11:00:00Z', 'Second')] };
  const ui = createGuide(doc, async () => ({ guide, updatedAt: now }), () => now);
  await ui.refresh();
  const [first, second] = doc.getElementById('epgRows').children;
  first.children[2].children[0].trigger('click');
  now += 20 * 60 * 1000;
  await ui.refresh();
  assert.ok(first.classes.has('selected'));
  assert.ok(!first.classes.has('on-air'));
  assert.ok(second.classes.has('on-air'));
});

test('empty or malformed guide does not replace last valid programmes', async () => {
  const doc = fakeDocument(), now = Date.parse('2026-05-01T10:15:00Z');
  let payload = { guide: { services: [], programmes: [programme('a', '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')] }, updatedAt: now };
  const ui = createGuide(doc, async () => payload, () => now);
  await ui.refresh();
  const first = doc.getElementById('epgRows').children[0];
  payload = { guide: { services: [], programmes: [] }, updatedAt: now + 1000 };
  await ui.refresh();
  assert.equal(doc.getElementById('epgRows').children[0], first);
  assert.match(doc.getElementById('epgState').textContent, /poslední program/);
  payload = { guide: null, updatedAt: null };
  await ui.refresh();
  assert.equal(doc.getElementById('epgRows').children[0], first);
});


test('detail follows on-air programme until a manual selection and falls back when it disappears', async () => {
  const doc = fakeDocument();
  let now = Date.parse('2026-05-01T10:15:00Z');
  let guide = { services: [], programmes: [programme('a', '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', 'First'), programme('a', '2026-05-01T10:30:00Z', '2026-05-01T11:00:00Z', 'Second')] };
  const ui = createGuide(doc, async () => ({ guide, updatedAt: now }), () => now);
  await ui.refresh();
  const rows = doc.getElementById('epgRows');
  assert.equal(doc.getElementById('epgDetail').children[0].textContent, 'First');
  now += 20 * 60000;
  await ui.refresh();
  assert.equal(doc.getElementById('epgDetail').children[0].textContent, 'Second');
  rows.children[0].children[2].children[0].trigger('click');
  await ui.refresh();
  assert.equal(doc.getElementById('epgDetail').children[0].textContent, 'First');
  guide = { ...guide, programmes: guide.programmes.slice(1) };
  await ui.refresh();
  assert.equal(doc.getElementById('epgDetail').children[0].textContent, 'Second');
});
