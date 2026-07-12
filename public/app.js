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
let language = 'cz';

const dictionaries = {
  cz: {
    htmlLang: 'cs',
    eyebrow: 'DAB MONITORING',
    title: 'EDI webový přehrávač',
    station: 'Stanice',
    play: 'Přehrát / znovu připojit',
    restart: 'Restart dekodéru',
    ediInput: 'EDI vstup',
    decoder: 'Dekodér stanice',
    diagnostics: 'Poslední diagnostika',
    waiting: 'Čekám na stav…',
    never: 'nikdy',
    seconds: 's',
    minutes: 'min',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI připojuji',
    ediOffline: 'EDI offline',
    apiOffline: 'Web API offline',
    endpoint: 'Endpoint',
    connection: 'Spojení',
    connected: 'připojeno',
    disconnected: 'odpojeno',
    lastData: 'Poslední data',
    received: 'Přijato',
    reconnects: 'Reconnecty',
    lastError: 'Poslední chyba',
    state: 'Stav',
    playing: 'Hraje',
    format: 'Formát',
    noDiagnostics: 'Bez diagnostických hlášení.',
    restartReason: 'Restart',
    playbackStarted: 'Přehrávání spuštěno.',
    browserWaits: 'Prohlížeč čeká na ruční spuštění',
    restartRequested: 'Restart dekodéru byl vyžádán.',
    restartFailed: 'Restart se nepodařil.',
    streamInterrupted: 'Audio stream se přerušil, nový pokus za 3 sekundy.'
  },
  en: {
    htmlLang: 'en',
    eyebrow: 'DAB MONITORING',
    title: 'EDI web player',
    station: 'Station',
    play: 'Play / reconnect',
    restart: 'Restart decoder',
    ediInput: 'EDI input',
    decoder: 'Station decoder',
    diagnostics: 'Last diagnostics',
    waiting: 'Waiting for status…',
    never: 'never',
    seconds: 's',
    minutes: 'min',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI connecting',
    ediOffline: 'EDI offline',
    apiOffline: 'Web API offline',
    endpoint: 'Endpoint',
    connection: 'Connection',
    connected: 'connected',
    disconnected: 'disconnected',
    lastData: 'Last data',
    received: 'Received',
    reconnects: 'Reconnects',
    lastError: 'Last error',
    state: 'State',
    playing: 'Playing',
    format: 'Format',
    noDiagnostics: 'No diagnostic messages.',
    restartReason: 'Restart',
    playbackStarted: 'Playback started.',
    browserWaits: 'Browser is waiting for manual start',
    restartRequested: 'Decoder restart requested.',
    restartFailed: 'Restart failed.',
    streamInterrupted: 'Audio stream was interrupted, retrying in 3 seconds.'
  },
  de: {
    htmlLang: 'de',
    eyebrow: 'DAB MONITORING',
    title: 'EDI-Webplayer',
    station: 'Station',
    play: 'Abspielen / neu verbinden',
    restart: 'Decoder neu starten',
    ediInput: 'EDI-Eingang',
    decoder: 'Stationsdecoder',
    diagnostics: 'Letzte Diagnose',
    waiting: 'Warte auf Status…',
    never: 'nie',
    seconds: 's',
    minutes: 'Min.',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI verbindet',
    ediOffline: 'EDI offline',
    apiOffline: 'Web-API offline',
    endpoint: 'Endpoint',
    connection: 'Verbindung',
    connected: 'verbunden',
    disconnected: 'getrennt',
    lastData: 'Letzte Daten',
    received: 'Empfangen',
    reconnects: 'Reconnects',
    lastError: 'Letzter Fehler',
    state: 'Status',
    playing: 'Spielt',
    format: 'Format',
    noDiagnostics: 'Keine Diagnosemeldungen.',
    restartReason: 'Restart',
    playbackStarted: 'Wiedergabe gestartet.',
    browserWaits: 'Browser wartet auf manuellen Start',
    restartRequested: 'Decoder-Neustart wurde angefordert.',
    restartFailed: 'Restart fehlgeschlagen.',
    streamInterrupted: 'Audiostream wurde unterbrochen, neuer Versuch in 3 Sekunden.'
  }
};

function t(key) {
  return dictionaries[language]?.[key] ?? dictionaries.cz[key] ?? key;
}

function applyTranslations() {
  document.documentElement.lang = t('htmlLang');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function age(timestamp) {
  if (!timestamp) return t('never');
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60
    ? `${seconds} ${t('seconds')}`
    : `${Math.floor(seconds / 60)} ${t('minutes')} ${seconds % 60} ${t('seconds')}`;
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
    language = ['cz', 'en', 'de'].includes(status.ui?.language) ? status.ui.language : 'cz';
    applyTranslations();
    const edi = status.edi;
    ediBadge.textContent = edi.connected ? t('ediOnline') : (edi.connecting ? t('ediConnecting') : t('ediOffline'));
    ediBadge.className = `badge ${edi.connected ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      [t('endpoint'), `${edi.host}:${edi.port}`],
      [t('connection'), edi.connected ? t('connected') : t('disconnected')],
      [t('lastData'), age(edi.lastDataAt)],
      [t('received'), bytes(edi.bytesReceived)],
      [t('reconnects'), edi.reconnects],
      [t('lastError'), edi.lastError ?? '—']
    ]);

    const station = selectedStatus();
    if (station) {
      stationStatus.innerHTML = rows([
        [t('state'), station.state],
        [t('playing'), serviceName(station.currentService, station.name)],
        ['SID', station.currentService?.sid ?? '—'],
        ['SubChId', station.currentService?.subChannelId ?? '—'],
        [t('format'), serviceFormat(station.currentService)],
      ]);
      diagnostic.textContent = [
        station.lastRestartReason ? `${t('restartReason')}: ${station.lastRestartReason}` : null,
        station.lastDablinMessage ? `DABlin: ${station.lastDablinMessage}` : null,
        station.lastFfmpegMessage ? `FFmpeg: ${station.lastFfmpegMessage}` : null
      ].filter(Boolean).join('\n') || t('noDiagnostics');
    }
  } catch (error) {
    ediBadge.textContent = t('apiOffline');
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
    message.textContent = t('playbackStarted');
  }).catch((error) => {
    message.textContent = `${t('browserWaits')}: ${error.message}`;
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
  message.textContent = response.ok ? t('restartRequested') : t('restartFailed');
});

audio.addEventListener('error', () => {
  message.textContent = t('streamInterrupted');
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(startPlayback, 3000);
});

async function init() {
  await loadStations();
  await refreshStatus();
  setInterval(refreshStatus, 2000);
}

init().catch((error) => {
  ediBadge.textContent = t('apiOffline');
  ediBadge.className = 'badge bad';
  message.textContent = error.message;
});
