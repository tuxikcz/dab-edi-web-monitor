import { loadConfig } from '../src/config.js';
const { config } = loadConfig(process.argv[2] ?? '/etc/dab-edi-web-monitor/config.json');
if (config.binaries.dablin !== '/opt/dab-edi-web-monitor/bin/dablin') {
  throw new Error('Set binaries.dablin to /opt/dab-edi-web-monitor/bin/dablin');
}
if (!config.edi.host.trim()) throw new Error('Set edi.host before starting DAB PROBE');
if (!Number.isInteger(config.edi.port) || config.edi.port > 65535) throw new Error('Invalid edi.port');
const port = config.probe?.port ?? 8090;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid probe.port');
if (!['127.0.0.1', '::1', 'localhost'].includes(config.listen.host) && !config.auth.enabled) {
  throw new Error('Enable authentication before binding beyond loopback');
}
console.log('DAB PROBE configuration OK');
