import net from 'node:net';

export async function detectEdiAf(edi) {
  return await new Promise((resolve) => {
    let done = false;
    const socket = net.createConnection({ host: edi.host, port: edi.port });

    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    }

    const timer = setTimeout(() => finish(false), Math.min(edi.dataTimeoutMs ?? 3000, 3000));
    timer.unref();

    socket.on('data', (chunk) => {
      finish(chunk.length >= 2 && chunk[0] === 0x41 && chunk[1] === 0x46);
    });
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

export async function correctEdiFormat(edi, log = console, tag = 'EDI') {
  if (edi.format === 'edi') return edi;
  if (!await detectEdiAf(edi)) return edi;

  log.info(`[${tag}] ${edi.host}:${edi.port} vypada jako EDI AF, prepinam format z eti na edi`);
  return { ...edi, format: 'edi', detectedFormat: 'edi' };
}
