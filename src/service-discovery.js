import net from 'node:net';
import { spawn } from 'node:child_process';

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function safeKillProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {}
}

function rememberService(services, sid) {
  let service = services.find((item) => item.sid === sid);
  if (!service) {
    service = { sid, label: null, shortLabel: null, subChannelId: null };
    services.push(service);
  }
  return service;
}

export function parseServiceLabelLine(line) {
  const match = line.match(/^FICDecoder: SId (0x[0-9A-Fa-f]+)(?:, SCIdS\s+\d+)?: (programme service|service component) label '(.*)' \('(.*)'\)$/);
  if (!match) return null;
  return {
    sid: match[1],
    type: match[2] === 'programme service' ? 'programme' : 'component',
    label: match[3],
    shortLabel: match[4]
  };
}

function parseServiceLine(services, line) {
  const audioMatch = line.match(/FICDecoder: SId (0x[0-9A-Fa-f]+): audio service \(SubChId\s+(\d+),/);
  if (audioMatch) {
    const service = rememberService(services, audioMatch[1]);
    service.subChannelId = Number(audioMatch[2]);
    return;
  }

  const label = parseServiceLabelLine(line);
  if (label) {
    const service = rememberService(services, label.sid);
    if (label.type === 'programme' || !service.label) {
      service.label = label.label;
      service.shortLabel = label.shortLabel;
    }
  }
}

export async function discoverServices(config, log = console, options = {}) {
  const seconds = options.seconds ?? config.stream?.discoverSeconds ?? 8;
  const services = [];

  log.info(`[discover] hledam audio sluzby v multiplexu ${config.edi.host}:${config.edi.port} (${seconds} s)`);

  return await new Promise((resolve, reject) => {
    let done = false;
    let pending = '';
    const dablin = spawn(config.binaries.dablin, ['-f', config.edi.format, '-I', '-F', '-p'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });
    const socket = net.createConnection({ host: config.edi.host, port: config.edi.port });

    function finish(error) {
      if (done) return;
      done = true;
      socket.destroy();
      safeKillProcessGroup(dablin, 'SIGTERM');
      setTimeout(() => safeKillProcessGroup(dablin, 'SIGKILL'), 500).unref();
      if (error) reject(error);
      else resolve(services);
    }

    dablin.stderr.setEncoding('utf8');
    dablin.stderr.on('data', (text) => {
      pending += stripAnsi(text);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const rawLine of lines) {
        parseServiceLine(services, rawLine.trim());
      }
    });

    socket.pipe(dablin.stdin);
    dablin.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') finish(error);
    });
    socket.on('error', finish);
    dablin.on('error', finish);
    dablin.on('exit', (code, signal) => {
      if (!done && services.length === 0) {
        finish(new Error(`DABlin discovery skoncil code=${code} signal=${signal}`));
      }
    });

    setTimeout(() => finish(), seconds * 1000).unref();
  });
}

export async function resolveServiceIndexSelectors(config, stations, log = console) {
  if (!stations.some((station) => station.selector.type === 'serviceIndex')) {
    return stations;
  }

  const services = await discoverServices(config, log);
  if (services.length === 0) {
    throw new Error('Discovery nenasel zadne audio sluzby v multiplexu');
  }

  const orderedServices = services.toSorted((left, right) => {
    if (left.subChannelId !== null && right.subChannelId !== null) {
      return left.subChannelId - right.subChannelId;
    }
    if (left.subChannelId !== null) return -1;
    if (right.subChannelId !== null) return 1;
    return 0;
  });

  log.info(`[discover] nalezeno ${orderedServices.length} audio sluzeb: ${orderedServices.map((service, index) => `${index + 1}:${service.sid}${service.subChannelId !== null ? `/SubChId ${service.subChannelId}` : ''}${service.label ? ` ${service.label}` : ''}`).join(', ')}`);

  return stations.map((station) => {
    if (station.selector.type !== 'serviceIndex') return station;

    const service = orderedServices[station.selector.value - 1];
    if (!service) {
      throw new Error(`Stanice ${station.id}: serviceIndex ${station.selector.value} mimo rozsah 1 az ${orderedServices.length}`);
    }

    const name = station.name || service.label || service.sid;
    log.info(`[${station.id}] serviceIndex ${station.selector.value} -> SID ${service.sid}${service.label ? ` (${service.label})` : ''}`);
    return {
      ...station,
      name,
      discoveredService: service,
      selector: { type: 'sid', value: service.sid }
    };
  });
}
