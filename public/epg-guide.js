// SPI timestamps are UTC. Calendar days and display times use the browser's timezone.
export const STALE_AFTER_MS = 60 * 60 * 1000;

export function localDay(value = new Date()) {
  const date = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayBounds(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (localDay(start) !== day) return null;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

export function stationsFromGuide(guide) {
  const names = new Map();
  for (const service of guide.services) {
    if (typeof service?.bearer === 'string' && service.bearer) names.set(service.bearer, service.name || service.bearer);
  }
  const stations = new Map();
  const seen = new Set();
  for (const programme of guide.programmes) {
    if (typeof programme?.bearer !== 'string' || !programme.bearer) continue;
    const start = Date.parse(programme.start), end = Date.parse(programme.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const key = JSON.stringify([programme.bearer, programme.start, programme.end, programme.name]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!stations.has(programme.bearer)) stations.set(programme.bearer, { bearer: programme.bearer, name: names.get(programme.bearer) || programme.bearer, programmes: [] });
    stations.get(programme.bearer).programmes.push({ ...programme, startMs: start, endMs: end, key });
  }
  for (const station of stations.values()) station.programmes.sort((a, b) => a.startMs - b.startMs);
  return [...stations.values()].sort((a, b) => a.name.localeCompare(b.name) || a.bearer.localeCompare(b.bearer));
}

export function programmesForDay(programmes, day) {
  const bounds = dayBounds(day);
  return bounds ? programmes.filter(p => p.startMs < bounds[1] && p.endMs > bounds[0]) : [];
}

export function isOnAir(programme, now = Date.now()) {
  return programme.startMs <= now && now < programme.endMs;
}

export function isStale(updatedAt, now = Date.now()) {
  return !Number.isFinite(updatedAt) || now - updatedAt >= STALE_AFTER_MS;
}

export function formatProgrammeTime(timestamp, day, locale) {
  const date = new Date(timestamp);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const dateNumber = value => Date.parse(`${value}T00:00:00Z`) / 86400000;
  const difference = dateNumber(localDay(date)) - dateNumber(day);
  const units = { cs: ['den', 'dny', 'dní'], en: ['day', 'days', 'days'], de: ['Tag', 'Tage', 'Tage'] }[locale] || ['day', 'days', 'days'];
  const n = Math.abs(difference);
  const unit = n === 1 ? units[0] : n >= 2 && n <= 4 ? units[1] : units[2];
  const sameWallTime = other => other.getFullYear() === date.getFullYear() && other.getMonth() === date.getMonth() && other.getDate() === date.getDate() && other.getHours() === date.getHours() && other.getMinutes() === date.getMinutes();
  // On a backward offset change the same local time occurs twice; mark the occurrence.
  let first = false, second = false;
  for (let delta = 15 * 60000; delta <= 3 * 3600000; delta += 15 * 60000) {
    first ||= sameWallTime(new Date(timestamp + delta));
    second ||= sameWallTime(new Date(timestamp - delta));
  }
  const occurrence = first ? ' ①' : second ? ' ②' : '';
  return time + occurrence + (difference ? ` (${difference > 0 ? '+' : ''}${difference} ${unit})` : '');
}

export function timeTooltip(timestamp, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long' }).format(new Date(timestamp));
}

const messages = {
  cs: { station: 'Stanice', day: 'Den', start: 'Začátek', end: 'Konec', programme: 'Pořad', detail: 'Detail pořadu', choose: 'Vyberte pořad pro zobrazení detailu.', empty: 'Pro vybranou stanici a den nejsou k dispozici žádné pořady.', waiting: 'Čekám na programová data.', updated: 'Poslední aktualizace', stale: 'Data mohou být zastaralá', unavailable: 'Aktualizace není dostupná; zobrazuji poslední program.', onAir: 'Právě vysíláno', noDescription: 'Popis není k dispozici.', timeInfo: 'Místní čas. Při opakované hodině ① označuje první a ② druhý výskyt.' },
  en: { station: 'Station', day: 'Day', start: 'Start', end: 'End', programme: 'Programme', detail: 'Programme details', choose: 'Select a programme to see its details.', empty: 'No programmes are available for this station and day.', waiting: 'Waiting for programme data.', updated: 'Last updated', stale: 'Guide may be out of date', unavailable: 'Update unavailable; showing the last guide.', onAir: 'On air', noDescription: 'No description available.', timeInfo: 'Local time. During a repeated hour, ① is the first and ② the second occurrence.' },
  de: { station: 'Station', day: 'Tag', start: 'Beginn', end: 'Ende', programme: 'Sendung', detail: 'Sendungsdetails', choose: 'Eine Sendung für Details auswählen.', empty: 'Für diese Station und diesen Tag sind keine Sendungen verfügbar.', waiting: 'Warte auf Programmdaten.', updated: 'Zuletzt aktualisiert', stale: 'Programmdaten möglicherweise veraltet', unavailable: 'Aktualisierung nicht verfügbar; der letzte Stand wird angezeigt.', onAir: 'Läuft gerade', noDescription: 'Keine Beschreibung verfügbar.', timeInfo: 'Ortszeit. Bei einer wiederholten Stunde steht ① für das erste und ② für das zweite Vorkommen.' }
};

export function createGuide(document, fetchGuide, clock = () => Date.now()) {
  const el = id => document.getElementById(id);
  const station = el('epgStation'), day = el('epgDay'), rows = el('epgRows'), detail = el('epgDetail'), state = el('epgState'), empty = el('epgEmpty');
  let stations = [], selected = null, manualSelection = false, updatedAt = null, failed = false, signature = null, lastLanguage = null, fetching = false;
  let rowElements = [];
  day.value = localDay(clock());
  const locale = () => messages[document.documentElement.lang] ? document.documentElement.lang : 'cs';
  const labels = () => messages[locale()];
  const currentRows = () => programmesForDay(stations.find(s => s.bearer === station.value)?.programmes ?? [], day.value);
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };

  function translate() {
    const text = labels();
    for (const [id, key] of Object.entries({ epgStationLabel: 'station', epgDayLabel: 'day', epgStartHeading: 'start', epgEndHeading: 'end', epgNameHeading: 'programme', epgDetailTitle: 'detail' })) el(id).textContent = text[key];
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    el('epgStartHeading').title = el('epgEndHeading').title = `${text.timeInfo} ${zone}`;
    lastLanguage = locale();
  }
  function renderStatus() {
    const text = labels();
    if (!updatedAt) { state.textContent = text.waiting; state.classList.remove('stale'); return; }
    const stale = isStale(updatedAt, clock());
    const parts = [`${text.updated}: ${new Date(updatedAt).toLocaleString(locale())}`];
    if (stale) parts.push(text.stale);
    if (failed) parts.push(text.unavailable);
    state.textContent = parts.join(' · ');
    state.classList.toggle('stale', stale || failed);
  }
  function renderDetail(programme) {
    detail.replaceChildren();
    if (!programme) { detail.append(element('p', labels().choose)); return; }
    detail.append(element('h4', programme.name || '—'));
    const short = programme.short_description?.trim() || '';
    const long = programme.long_description?.trim() || '';
    if (short) detail.append(element('p', short));
    if (long && long !== short) detail.append(element('p', long));
    if (!short && !long) detail.append(element('p', labels().noDescription));
  }
  function autoSelect(programmes) {
    if (manualSelection && programmes.some(p => p.key === selected)) return false;
    manualSelection = false;
    const next = programmes.find(p => isOnAir(p, clock()))?.key ?? null;
    if (next === selected) return false;
    selected = next;
    return true;
  }
  function updateHighlights() {
    for (const { row, programme, button } of rowElements) {
      const current = isOnAir(programme, clock());
      row.classList.toggle('on-air', current);
      row.classList.toggle('selected', programme.key === selected);
      button.setAttribute('aria-pressed', String(programme.key === selected));
      const marker = row.querySelector('.epg-on-air');
      marker.textContent = current ? labels().onAir : '';
    }
  }
  function renderRows() {
    const programmes = currentRows();
    autoSelect(programmes);
    rows.replaceChildren(); rowElements = [];
    empty.textContent = programmes.length ? '' : (stations.length ? labels().empty : '');
    for (const programme of programmes) {
      const row = document.createElement('tr');
      for (const timestamp of [programme.startMs, programme.endMs]) {
        const cell = element('td', formatProgrammeTime(timestamp, day.value, locale()));
        cell.title = timeTooltip(timestamp, locale());
        row.append(cell);
      }
      const name = document.createElement('td'), button = element('button', programme.name || '—'), marker = element('span', '');
      button.type = 'button'; button.className = 'epg-programme'; marker.className = 'epg-on-air';
      button.addEventListener('click', () => { selected = programme.key; manualSelection = true; updateHighlights(); renderDetail(programme); });
      name.append(button, marker); row.append(name); rows.append(row); rowElements.push({ row, programme, button });
    }
    updateHighlights();
    renderDetail(programmes.find(p => p.key === selected));
  }
  function renderStations() {
    const previous = station.value;
    station.replaceChildren();
    for (const item of stations) { const option = element('option', item.name); option.value = item.bearer; station.append(option); }
    station.disabled = !stations.length;
    station.value = stations.some(item => item.bearer === previous) ? previous : (stations[0]?.bearer ?? '');
  }
  station.addEventListener('change', () => { selected = null; manualSelection = false; renderRows(); });
  day.addEventListener('change', () => { selected = null; manualSelection = false; renderRows(); });
  translate(); renderStatus(); renderRows();
  async function refresh() {
    if (lastLanguage !== locale()) { translate(); renderRows(); }
    if (autoSelect(currentRows())) renderDetail(currentRows().find(p => p.key === selected));
    updateHighlights(); renderStatus();
    if (fetching) return;
    fetching = true;
    try {
      const data = await fetchGuide();
      if (data?.guide && Array.isArray(data.guide.services) && Array.isArray(data.guide.programmes) && Number.isFinite(data.updatedAt)) {
        const next = JSON.stringify(data.guide);
        if (signature !== next) {
          const received = stationsFromGuide(data.guide);
          if (!received.length) throw new Error('No valid programmes');
          stations = received; signature = next; renderStations(); renderRows();
        }
        updatedAt = data.updatedAt;
        failed = Boolean(data.error);
      } else { failed = true; }
    } catch { failed = true; }
    finally { fetching = false; renderStatus(); }
  }
  return { refresh };
}

if (typeof document !== 'undefined') {
  const guide = createGuide(document, async () => {
    const response = await fetch('/api/epg', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  guide.refresh();
  const timer = setInterval(() => guide.refresh(), 5000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
}
