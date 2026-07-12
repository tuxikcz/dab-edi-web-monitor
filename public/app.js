const stationSelect = document.querySelector('#station');
const audio = document.querySelector('#audio');
const playButton = document.querySelector('#play');
const restartButton = document.querySelector('#restart');
const ediBadge = document.querySelector('#ediBadge');
const ediStatus = document.querySelector('#ediStatus');
const stationStatus = document.querySelector('#stationStatus');
const diagnostic = document.querySelector('#diagnostic');
const message = document.querySelector('#message');

let stations = [];
let status = null;
let reconnectTimer = null;

function age(timestamp) {
  if (!timestamp) return 'nikdy';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function bytes(value) {
  if (!Number.isFinite(value)) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let number = value;
  let unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit += 1; }
  return `${number.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function rows(items) {
  return items.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
}

function selectedStatus() {
  return status?.stations?.find((item) => item.id === stationSelect.value);
}

function serviceName(service, fallback) {
  return service?.label || service?.shortLabel || service?.sid || fallback || '—';
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

async function loadStations() {
  const response = await fetch('/api/stations', { cache: 'no-store' });
  stations = await response.json();
  stationSelect.innerHTML = stations.map((station) =>
    `<option value="${station.id}">${station.name}</option>`
  ).join('');
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    status = await response.json();
    const edi = status.edi;
    ediBadge.textContent = edi.connected ? 'EDI online' : (edi.connecting ? 'EDI připojuji' : 'EDI offline');
    ediBadge.className = `badge ${edi.connected ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      ['Endpoint', `${edi.host}:${edi.port}`],
      ['Spojení', edi.connected ? 'připojeno' : 'odpojeno'],
      ['Poslední data', age(edi.lastDataAt)],
      ['Přijato', bytes(edi.bytesReceived)],
      ['Reconnecty', edi.reconnects],
      ['Poslední chyba', edi.lastError ?? '—']
    ]);

    const station = selectedStatus();
    if (station) {
      stationStatus.innerHTML = rows([
        ['Stav', station.state],
        ['Hraje', serviceName(station.currentService, station.name)],
        ['SID', station.currentService?.sid ?? '—'],
        ['SubChId', station.currentService?.subChannelId ?? '—'],
        ['Formát', serviceFormat(station.currentService)],
      ]);
      diagnostic.textContent = [
        station.lastRestartReason ? `Restart: ${station.lastRestartReason}` : null,
        station.lastDablinMessage ? `DABlin: ${station.lastDablinMessage}` : null,
        station.lastFfmpegMessage ? `FFmpeg: ${station.lastFfmpegMessage}` : null
      ].filter(Boolean).join('\n') || 'Bez diagnostických hlášení.';
    }
  } catch (error) {
    ediBadge.textContent = 'Web API offline';
    ediBadge.className = 'badge bad';
    message.textContent = error.message;
  }
}

function startPlayback() {
  clearTimeout(reconnectTimer);
  const id = stationSelect.value;
  if (!id) return;
  audio.src = `/stream/${encodeURIComponent(id)}.mp3?t=${Date.now()}`;
  audio.load();
  audio.play().then(() => {
    message.textContent = 'Přehrávání spuštěno.';
  }).catch((error) => {
    message.textContent = `Prohlížeč čeká na ruční spuštění: ${error.message}`;
  });
}

stationSelect.addEventListener('change', () => {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  refreshStatus();
});
playButton.addEventListener('click', startPlayback);
restartButton.addEventListener('click', async () => {
  const id = stationSelect.value;
  const response = await fetch(`/api/restart/${encodeURIComponent(id)}`, { method: 'POST' });
  message.textContent = response.ok ? 'Restart dekodéru byl vyžádán.' : 'Restart se nepodařil.';
});

audio.addEventListener('error', () => {
  message.textContent = 'Audio stream se přerušil, nový pokus za 3 sekundy.';
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(startPlayback, 3000);
});

async function init() {
  await loadStations();
  await refreshStatus();
  setInterval(refreshStatus, 2000);
}

init().catch((error) => {
  ediBadge.textContent = 'Web API offline';
  ediBadge.className = 'badge bad';
  message.textContent = error.message;
});
