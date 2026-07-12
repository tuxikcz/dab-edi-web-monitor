import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configArg = process.argv.indexOf('--config');
const configPath = configArg >= 0 ? process.argv[configArg + 1] : process.env.CONFIG ?? path.resolve(__dirname, '../config.json');
const { config } = loadConfig(configPath);
const seconds = Number(process.env.DISCOVER_SECONDS ?? 20);

console.log(`Spoustim diagnostiku DABlinu na ${config.edi.host}:${config.edi.port} po dobu ${seconds} s.`);
console.log('Vystup je zavisly na verzi DABlinu; hledejte service label a SID.');

const dablin = spawn(config.binaries.dablin, ['-f', 'edi', '-I', '-F', '-p'], {
  detached: true,
  stdio: ['pipe', 'ignore', 'pipe']
});
const socket = net.createConnection({ host: config.edi.host, port: config.edi.port });

dablin.stderr.pipe(process.stdout);
socket.pipe(dablin.stdin);

function stop(code = 0) {
  socket.destroy();
  try { process.kill(-dablin.pid, 'SIGTERM'); } catch {}
  setTimeout(() => {
    try { process.kill(-dablin.pid, 'SIGKILL'); } catch {}
    process.exit(code);
  }, 500).unref();
}

socket.on('connect', () => console.log('EDI TCP spojeni navazano.'));
socket.on('error', (error) => {
  console.error(`EDI chyba: ${error.message}`);
  stop(1);
});
dablin.on('error', (error) => {
  console.error(`DABlin chyba: ${error.message}`);
  stop(1);
});
dablin.on('exit', (code, signal) => {
  console.log(`DABlin skoncil code=${code} signal=${signal}`);
  stop(code ?? 1);
});
setTimeout(() => stop(0), seconds * 1000).unref();
