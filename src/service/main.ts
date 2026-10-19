import { createService } from './runtime/server.js';
import { hostClient } from './runtime/settings.js';

const rawPort = process.env.OPENCHAMBER_SERVICE_PORT ?? '';
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535 || !token) {
  console.error('OpenChamber service port and token are required.');
  process.exit(1);
}

const service = createService({ token, client: hostClient });
service.server.on('error', () => {
  console.error('Unable to start the extension service.');
  process.exitCode = 1;
});
service.server.listen(port, '127.0.0.1');

let closing = false;
const shutdown = (): void => {
  if (closing) return;
  closing = true;
  void service.close().catch(() => { process.exitCode = 1; });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
