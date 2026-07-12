import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configArg = process.argv.indexOf('--config');
const configPath = configArg >= 0 ? process.argv[configArg + 1] : process.env.CONFIG ?? path.resolve(__dirname, '../config.json');
const { config } = loadConfig(configPath);
const durationMs = Number(process.env.TEST_SECONDS ?? 10) * 1000;
let bytes = 0;
let chunks = 0;
let firstBytes = null;
const started = Date.now();

console.log(`Pripojuji se na ${config.edi.host}:${config.edi.port} ...`);
const socket = net.createConnection({ host: config.edi.host, port: config.edi.port });
socket.setTimeout(config.edi.connectTimeoutMs);
socket.on('connect', () => console.log('TCP spojeni navazano.'));
socket.on('data', (chunk) => {
  bytes += chunk.length;
  chunks += 1;
  firstBytes ??= chunk.subarray(0, 32);
});
socket.on('timeout', () => socket.destroy(new Error('TCP timeout')));
socket.on('error', (error) => {
  console.error(`Chyba: ${error.message}`);
  process.exitCode = 1;
});
socket.on('close', () => {
  const seconds = Math.max((Date.now() - started) / 1000, 0.001);
  console.log(`Prijato ${bytes} B v ${chunks} blocich (${Math.round(bytes / seconds)} B/s).`);
  if (firstBytes) console.log(`Prvnich ${firstBytes.length} B: ${firstBytes.toString('hex').match(/.{1,2}/g).join(' ')}`);
});
setTimeout(() => socket.end(), durationMs).unref();
