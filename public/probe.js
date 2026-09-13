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
const diagnostic = document.querySelector('#diagnostic');
const ediStatus = document.querySelector('#ediStatus');
const stationStatus = document.querySelector('#stationStatus');
const metadataPanel = document.querySelector('#metadataPanel');
const dynamicLabel = document.querySelector('#dynamicLabel');
const dlPlus = document.querySelector('#dlPlus');
const slideImage = document.querySelector('#slideImage');

let statusTimer = null;
let defaultsApplied = false;
let language = 'cz';

const dictionaries = {
  cz: {
    htmlLang: 'cs',
    title: 'EDI stream probe',
    disconnected: 'Nepřipojeno',
    host: 'IP adresa / host',
    port: 'Port',
    format: 'Formát',
    discovery: 'Discovery',
    loadStations: 'Načíst stanice',
    foundStations: 'Nalezené stanice',
    playback: 'Přehrávání',
    ediInput: 'EDI vstup',
    decoder: 'Dekodér stanice',
    never: 'nikdy',
    seconds: 's',
    minutes: 'min',
    unknownService: 'Neznámá služba',
    noStations: 'Zatím nejsou načtené žádné stanice.',
    noDiagnostics: 'Bez diagnostických hlášení.',
    restartReason: 'Restart',
    collapse: 'Skrýt',
    expand: 'Zobrazit',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI připojuji',
    ediOffline: 'EDI offline',
    stationsLoaded: 'Stanice načteny',
    endpoint: 'Endpoint',
    inputFormat: 'Formát vstupu',
    connection: 'Spojení',
    connected: 'připojeno',
    received: 'Přijato',
    lastData: 'Poslední data',
    reconnects: 'Reconnecty',
    lastError: 'Poslední chyba',
    stream: 'Stream',
    selected: 'Vybráno',
    state: 'Stav',
    ensemble: 'Multiplex',
    playing: 'Hraje',
    nowPlaying: 'Právě hraje',
    noMetadata: 'Bez textových metadat.',
    artist: 'Interpret',
    songTitle: 'Skladba',
    homepage: 'Web',
    stationName: 'Stanice',
    programme: 'Program',
    slideAlt: 'Doprovodný obrázek stanice',
    loadingStations: 'Načítám seznam stanic…',
    stationsFound: (count) => `Nalezeno ${count} stanic.`,
    startingPlayback: 'Spouštím přehrávání…',
    playbackStarted: 'Přehrávání spuštěno.',
    browserWaits: 'Prohlížeč čeká na ruční spuštění'
  },
  en: {
    htmlLang: 'en',
    title: 'EDI stream probe',
    disconnected: 'Disconnected',
    host: 'IP address / host',
    port: 'Port',
    format: 'Format',
    discovery: 'Discovery',
    loadStations: 'Load stations',
    foundStations: 'Found stations',
    playback: 'Playback',
    ediInput: 'EDI input',
    decoder: 'Station decoder',
    never: 'never',
    seconds: 's',
    minutes: 'min',
    unknownService: 'Unknown service',
    noStations: 'No stations loaded yet.',
    noDiagnostics: 'No diagnostic messages.',
    restartReason: 'Restart',
    collapse: 'Hide',
    expand: 'Show',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI connecting',
    ediOffline: 'EDI offline',
    stationsLoaded: 'Stations loaded',
    endpoint: 'Endpoint',
    inputFormat: 'Input format',
    connection: 'Connection',
    connected: 'connected',
    received: 'Received',
    lastData: 'Last data',
    reconnects: 'Reconnects',
    lastError: 'Last error',
    stream: 'Stream',
    selected: 'Selected',
    state: 'State',
    ensemble: 'Ensemble',
    playing: 'Playing',
    nowPlaying: 'Now playing',
    noMetadata: 'No text metadata.',
    artist: 'Artist',
    songTitle: 'Title',
    homepage: 'Homepage',
    stationName: 'Station',
    programme: 'Programme',
    slideAlt: 'Station slideshow image',
    loadingStations: 'Loading station list…',
    stationsFound: (count) => `Found ${count} stations.`,
    startingPlayback: 'Starting playback…',
    playbackStarted: 'Playback started.',
    browserWaits: 'Browser is waiting for manual start'
  },
  de: {
    htmlLang: 'de',
    title: 'EDI-Stream-Probe',
    disconnected: 'Nicht verbunden',
    host: 'IP-Adresse / Host',
    port: 'Port',
    format: 'Format',
    discovery: 'Discovery',
    loadStations: 'Stationen laden',
    foundStations: 'Gefundene Stationen',
    playback: 'Wiedergabe',
    ediInput: 'EDI-Eingang',
    decoder: 'Stationsdecoder',
    never: 'nie',
    seconds: 's',
    minutes: 'Min.',
    unknownService: 'Unbekannte Station',
    noStations: 'Noch keine Stationen geladen.',
    noDiagnostics: 'Keine Diagnosemeldungen.',
    restartReason: 'Restart',
    collapse: 'Ausblenden',
    expand: 'Anzeigen',
    ediOnline: 'EDI online',
    ediConnecting: 'EDI verbindet',
    ediOffline: 'EDI offline',
    stationsLoaded: 'Stationen geladen',
    endpoint: 'Endpoint',
    inputFormat: 'Eingangsformat',
    connection: 'Verbindung',
    connected: 'verbunden',
    received: 'Empfangen',
    lastData: 'Letzte Daten',
    reconnects: 'Reconnects',
    lastError: 'Letzter Fehler',
    stream: 'Stream',
    selected: 'Ausgewählt',
    state: 'Status',
    ensemble: 'Ensemble',
    playing: 'Spielt',
    nowPlaying: 'Aktuell',
    noMetadata: 'Keine Textmetadaten.',
    artist: 'Interpret',
    songTitle: 'Titel',
    homepage: 'Web',
    stationName: 'Station',
    programme: 'Programm',
    slideAlt: 'Begleitbild der Station',
    loadingStations: 'Stationsliste wird geladen…',
    stationsFound: (count) => `${count} Stationen gefunden.`,
    startingPlayback: 'Wiedergabe wird gestartet…',
    playbackStarted: 'Wiedergabe gestartet.',
    browserWaits: 'Browser wartet auf manuellen Start'
  }
};

function t(key, ...args) {
  const value = dictionaries[language]?.[key] ?? dictionaries.cz[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

function applyTranslations() {
  document.documentElement.lang = t('htmlLang');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('.panel-toggle').forEach((button) => {
    const expanded = button.getAttribute('aria-expanded') !== 'false';
    button.textContent = expanded ? '⌄' : '›';
    button.setAttribute('aria-label', t(expanded ? button.dataset.i18nExpanded : button.dataset.i18nCollapsed));
  });
}

function setupCollapsiblePanels() {
  document.querySelectorAll('[data-collapsible]').forEach((panel) => {
    const button = panel.querySelector('.panel-toggle');
    const body = panel.querySelector('.panel-body');
    if (!button || !body) return;

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'false';
      button.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
      panel.classList.toggle('collapsed', expanded);
      button.textContent = expanded ? '›' : '⌄';
      button.setAttribute('aria-label', t(expanded ? button.dataset.i18nCollapsed : button.dataset.i18nExpanded));
    });
  });
}

function rows(items) {
  return items.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
}

function textRows(items) {
  dlPlus.replaceChildren();
  for (const [key, value] of items) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    dlPlus.append(dt, dd);
  }
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
  if (!timestamp) return t('never');
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 60
    ? `${seconds} ${t('seconds')}`
    : `${Math.floor(seconds / 60)} ${t('minutes')} ${seconds % 60} ${t('seconds')}`;
}

function serviceName(service) {
  return service?.label || service?.shortLabel || service?.sid || t('unknownService');
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

function dlPlusLabel(item) {
  const type = item?.content_type_name ?? '';
  if (type === 'ITEM.ARTIST') return t('artist');
  if (type === 'ITEM.TITLE') return t('songTitle');
  if (type === 'PROGRAMME.HOMEPAGE') return t('homepage');
  if (type === 'STATIONNAME.SHORT' || type === 'STATIONNAME.LONG') return t('stationName');
  if (type.startsWith('PROGRAMME.')) return t('programme');
  return type || 'DL+';
}

function renderMetadata(station) {
  const metadata = station?.metadata ?? {};
  dynamicLabel.textContent = metadata.dynamicLabel || t('noMetadata');

  const items = (metadata.dlPlus ?? [])
    .map((item) => [dlPlusLabel(item), String(item?.text ?? '').trim()])
    .filter(([, value]) => value);
  textRows(items);

  if (metadata.slide?.url) {
    const probeSlideUrl = `/api/slide/probe?t=${encodeURIComponent(metadata.slideUpdatedAt ?? Date.now())}`;
    if (slideImage.getAttribute('src') !== probeSlideUrl) {
      slideImage.src = probeSlideUrl;
    }
    slideImage.alt = t('slideAlt');
    slideImage.hidden = false;
    metadataPanel.classList.remove('no-slide');
  } else {
    slideImage.removeAttribute('src');
    slideImage.alt = '';
    slideImage.hidden = true;
    metadataPanel.classList.add('no-slide');
  }
}

function renderServices(list, activeSid) {
  if (!list?.length) {
    services.innerHTML = `<p class="empty">${t('noStations')}</p>`;
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
  language = ['cz', 'en', 'de'].includes(status.ui?.language) ? status.ui.language : 'cz';
  applyTranslations();

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
    probeBadge.textContent = edi.connected ? t('ediOnline') : (edi.connecting ? t('ediConnecting') : t('ediOffline'));
    probeBadge.className = `badge ${edi.connected ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      [t('endpoint'), `${edi.host}:${edi.port}`],
      [t('inputFormat'), edi.format ?? status.probe?.edi?.format ?? '—'],
      [t('connection'), edi.connected ? t('connected') : t('disconnected')],
      [t('lastData'), age(edi.lastDataAt)],
      [t('received'), bytes(edi.bytesReceived)],
      [t('reconnects'), edi.reconnects],
      [t('lastError'), edi.lastError ?? '—']
    ]);
  } else {
    probeBadge.textContent = status.probe?.services?.length ? t('stationsLoaded') : t('disconnected');
    probeBadge.className = `badge ${status.probe?.services?.length ? 'ok' : 'bad'}`;
    ediStatus.innerHTML = rows([
      [t('endpoint'), status.probe?.edi ? `${status.probe.edi.host}:${status.probe.edi.port}` : '—'],
      [t('inputFormat'), status.probe?.edi?.format ?? '—'],
      [t('connection'), '—'],
      [t('lastData'), '—'],
      [t('received'), '—']
    ]);
  }

  playbackStatus.innerHTML = rows([
    [t('stream'), status.stream ?? '—'],
    [t('selected'), serviceName(status.activeService)]
  ]);

  stationStatus.innerHTML = rows([
    [t('state'), station?.state ?? '—'],
    [t('ensemble'), station?.currentEnsemble?.label || station?.currentEnsemble?.id || '—'],
    ['EId', station?.currentEnsemble?.id ?? '—'],
    [t('playing'), serviceName(station?.currentService)],
    ['SID', station?.currentService?.sid ?? status.activeService?.sid ?? '—'],
    ['SubChId', station?.currentService?.subChannelId ?? '—'],
    [t('format'), serviceFormat(station?.currentService)]
  ]);
  diagnostic.textContent = [
    station?.lastRestartReason ? `${t('restartReason')}: ${station.lastRestartReason}` : null,
    station?.lastDablinArgs ? `DABlin args: ${station.lastDablinArgs.join(' ')}` : null,
    station?.lastDablinMessage ? `DABlin: ${station.lastDablinMessage}` : null,
    station?.lastFfmpegMessage ? `FFmpeg: ${station.lastFfmpegMessage}` : null
  ].filter(Boolean).join('\n') || t('noDiagnostics');
  renderMetadata(station);
}

async function fetchStatus() {
  const response = await fetch('/api/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  renderStatus(await response.json());
}

async function probe(event) {
  event.preventDefault();
  probeButton.disabled = true;
  message.textContent = t('loadingStations');
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
      ? t('stationsFound', status.probe.services.length)
      : (status.probe?.error || status.error || `HTTP ${response.status}`);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    probeButton.disabled = false;
  }
}

async function play(sid) {
  message.textContent = t('startingPlayback');
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
    message.textContent = t('playbackStarted');
  }).catch((error) => {
    message.textContent = `${t('browserWaits')}: ${error.message}`;
  });
}

form.addEventListener('submit', probe);
setupCollapsiblePanels();

fetchStatus().catch((error) => {
  message.textContent = error.message;
});
statusTimer = setInterval(() => {
  fetchStatus().catch(() => {});
}, 2000);
window.addEventListener('beforeunload', () => clearInterval(statusTimer));
