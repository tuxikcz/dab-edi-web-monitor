import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  throw new Error(`Chyba konfigurace: ${message}`);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  let config;

  try {
    config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(`nelze nacist ${resolved}: ${error.message}`);
  }

  if (!config.listen || typeof config.listen.host !== 'string' || !isPositiveInteger(config.listen.port)) {
    fail('listen.host a listen.port jsou povinne');
  }

  if (!config.edi || typeof config.edi.host !== 'string' || !isPositiveInteger(config.edi.port)) {
    fail('edi.host a edi.port jsou povinne');
  }
  config.edi.format ??= 'edi';
  if (!['edi', 'eti'].includes(config.edi.format)) {
    fail('edi.format musi byt "edi" nebo "eti"');
  }

  if (!config.binaries || typeof config.binaries.dablin !== 'string' || typeof config.binaries.ffmpeg !== 'string') {
    fail('binaries.dablin a binaries.ffmpeg jsou povinne');
  }

  if (!Array.isArray(config.stations) || config.stations.length === 0) {
    fail('stations musi obsahovat alespon jednu stanici');
  }

  const ids = new Set();
  for (const station of config.stations) {
    if (!station || typeof station.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(station.id)) {
      fail('station.id muze obsahovat jen pismena, cislice, podtrzitko a pomlcku');
    }
    if (ids.has(station.id)) {
      fail(`duplicitni station.id: ${station.id}`);
    }
    ids.add(station.id);

    if (typeof station.name !== 'string' || station.name.trim() === '') {
      fail(`stanice ${station.id} nema name`);
    }

    const selector = station.selector;
    if (!selector || !['first', 'sid', 'label', 'serviceIndex'].includes(selector.type)) {
      fail(`stanice ${station.id} ma neplatny selector.type`);
    }
    if (selector.type === 'sid' && typeof selector.value !== 'string') {
      fail(`stanice ${station.id}: selector SID vyzaduje textovou value, napr. 0x24F8`);
    }
    if (selector.type === 'label' && typeof selector.value !== 'string') {
      fail(`stanice ${station.id}: selector label vyzaduje value`);
    }
    if (selector.type === 'serviceIndex' && !isPositiveInteger(selector.value)) {
      fail(`stanice ${station.id}: selector serviceIndex vyzaduje kladne cislo, napr. 1`);
    }
  }

  config.stream ??= {};
  config.stream.discoverSeconds ??= 8;
  if (!isPositiveInteger(config.stream.discoverSeconds)) {
    fail('stream.discoverSeconds musi byt kladne cele cislo');
  }
  config.stream.stationIndex ??= null;
  config.stream.stationArrayIndex = null;
  if (config.stream.stationIndex !== null) {
    if (!Number.isInteger(config.stream.stationIndex)) {
      fail(`stream.stationIndex musi byt null nebo cislo 1 az ${config.stations.length}`);
    }
    if (config.stream.stationIndex === 0) {
      config.stream.stationArrayIndex = 0;
    } else if (config.stream.stationIndex >= 1 && config.stream.stationIndex <= config.stations.length) {
      config.stream.stationArrayIndex = config.stream.stationIndex - 1;
    } else {
      fail(`stream.stationIndex musi byt null nebo cislo 1 az ${config.stations.length}`);
    }
  }

  config.edi.connectTimeoutMs ??= 5000;
  config.edi.dataTimeoutMs ??= 7000;
  config.edi.reconnectMinMs ??= 1000;
  config.edi.reconnectMaxMs ??= 15000;

  config.audio ??= {};
  config.audio.bitrate ??= '128k';
  config.audio.sampleRate ??= 48000;
  config.audio.channels ??= 2;

  config.watchdog ??= {};
  config.watchdog.startupGraceMs ??= 12000;
  config.watchdog.pcmTimeoutMs ??= 8000;
  config.watchdog.mp3TimeoutMs ??= 12000;
  config.watchdog.checkIntervalMs ??= 1000;
  config.watchdog.restartDelayMs ??= 1500;
  config.watchdog.killTimeoutMs ??= 1500;
  config.watchdog.maxInputBufferBytes ??= 2 * 1024 * 1024;
  config.watchdog.maxClientBufferBytes ??= 1024 * 1024;

  config.auth ??= { enabled: false };
  config.auth.enabled = Boolean(config.auth.enabled);

  config.ui ??= {};
  config.ui.language ??= 'cz';
  if (!['cz', 'en', 'de'].includes(config.ui.language)) {
    fail('ui.language musi byt "cz", "en" nebo "de"');
  }

  return { config, resolvedPath: resolved };
}
