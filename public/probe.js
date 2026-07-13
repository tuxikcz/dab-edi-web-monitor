const form = document.querySelector('#probeForm');
const hostInput = document.querySelector('#host');
const portInput = document.querySelector('#port');
const formatInput = document.querySelector('#format');
const discoverSecondsInput = document.querySelector('#discoverSeconds');
const probeButton = document.querySelector('#probeButton');
const probeBadge = document.querySelector('#probeBadge');
const message = document.querySelector('#message');
const services = document.querySelector('#services');
const audio = document.querySelector('#audio');
const playbackStatus = document.querySelector('#playbackStatus');
const ediStatus = document.querySelector('#ediStatus');
const stationStatus = document.querySelector('#stationStatus');

let statusTimer = null;
let defaultsApplied = false;

function rows(items) {
  return items.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
}

function bytes(value) {
  if (!Number.isFinite(value)) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let number = value;
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
  return `${number.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function age(timestamp) {
  if (!timestamp) return 'nikdy';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function serviceName(service) {
  return service?.label || service?.shortLabel || service?.sid || 'Neznámá služba';
}

function serviceFormat(service) {
  const parts = [
    service?.codec,
    service?.sampleRate ? `${Math.round(service.sampleRate / 1000)} kHz` : null,
    service?.channels,
    service?.bitrate
  ].filter(Boolean);
  return parts.join(', ') || '—';
}

function renderServices(list, activeSid) {
  if (!list?.length) {
    services.innerHTML = '<p class="empty">Zatím nejsou načtené žádné stanice.</p>';
    return;
  }

  services.replaceChildren();
  for (const service of list) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `station-option${service.sid === activeSid ? ' active' : ''}`;
    item.innerHTML = `
      <span>${serviceName(service)}</span>
      <small>${[
        service.sid,
        service.subChannelId !== null ? `SubChId ${service.subChannelId}` : null
      ].filter(Boolean).join(' · ')}</small>
    `;
    item.addEventListener('click', () => play(service.sid));
    services.append(item);
  }
}

function renderStatus(status) {
  const edi = status.edi;
  const station = status.station;
  const activeSid = status.activeService?.sid ?? null;

  if (!defaultsApplied && status.defaults) {
    hostInput.value ||= status.defaults.host ?? '';
    portInput.value ||= status.defaults.port ?? '';
    formatInput.value = status.defaults.format ?? 'edi';
    discoverSecondsInput.value ||= status.defaults.discoverSeconds ?? 8;
    defaultsApplied = true;
  }

  renderServices(status.probe?.services ?? [], activeSid);

  if (edi) {
    probeBadge.textContent = edi.connected ? 'EDI online' : (edi.connecting ? 'EDI připojuji' : 'EDI offline');
    probeBadge.className = `badge ${edi.connected ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      ['Endpoint', `${edi.host}:${edi.port}`],
      ['Spojení', edi.connected ? 'připojeno' : 'odpojeno'],
      ['Poslední data', age(edi.lastDataAt)],
      ['Přijato', bytes(edi.bytesReceived)],
      ['Reconnecty', edi.reconnects],
      ['Poslední chyba', edi.lastError ?? '—']
    ]);
  } else {
    probeBadge.textContent = status.probe?.services?.length ? 'Stanice načteny' : 'Nepřipojeno';
    probeBadge.className = `badge ${status.probe?.services?.length ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      ['Endpoint', status.probe?.edi ? `${status.probe.edi.host}:${status.probe.edi.port}` : '—'],
      ['Spojení', '—'],
      ['Poslední data', '—'],
      ['Přijato', '—']
    ]);
  }

  playbackStatus.innerHTML = rows([
    ['Stream', status.stream ?? '—'],
    ['Vybráno', serviceName(status.activeService)]
  ]);

  stationStatus.innerHTML = rows([
    ['Stav', station?.state ?? '—'],
    ['Multiplex', station?.currentEnsemble?.label || station?.currentEnsemble?.id || '—'],
    ['EId', station?.currentEnsemble?.id ?? '—'],
    ['Hraje', serviceName(station?.currentService)],
    ['SID', station?.currentService?.sid ?? status.activeService?.sid ?? '—'],
    ['SubChId', station?.currentService?.subChannelId ?? '—'],
    ['Formát', serviceFormat(station?.currentService)]
  ]);
}

async function fetchStatus() {
  const response = await fetch('/api/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  renderStatus(await response.json());
}

async function probe(event) {
  event.preventDefault();
  probeButton.disabled = true;
  message.textContent = 'Načítám seznam stanic…';
  audio.pause();
  audio.removeAttribute('src');
  audio.load();

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const status = await response.json();
    renderStatus(status);
    message.textContent = response.ok
      ? `Nalezeno ${status.probe.services.length} stanic.`
      : (status.probe?.error || status.error || `HTTP ${response.status}`);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    probeButton.disabled = false;
  }
}

async function play(sid) {
  message.textContent = 'Spouštím přehrávání…';
  const response = await fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid })
  });
  const status = await response.json();
  if (!response.ok) {
    message.textContent = status.error || `HTTP ${response.status}`;
    return;
  }

  renderStatus(status);
  audio.src = `${status.stream}?t=${Date.now()}`;
  audio.load();
  audio.play().then(() => {
    message.textContent = 'Přehrávání spuštěno.';
  }).catch((error) => {
    message.textContent = `Prohlížeč čeká na ruční spuštění: ${error.message}`;
  });
}

form.addEventListener('submit', probe);

fetchStatus().catch((error) => {
  message.textContent = error.message;
});
statusTimer = setInterval(() => {
  fetchStatus().catch(() => {});
}, 2000);
window.addEventListener('beforeunload', () => clearInterval(statusTimer));
