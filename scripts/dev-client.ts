// Starts the editor client only - IDE module responsibility.
// Usage: bun scripts/dev-client.ts --clientPort=15173 --serverPort=18080 --project=<name>
import { resolve } from 'node:path';
import { parseFlags } from './args';

const flags = parseFlags(process.argv.slice(2));
const clientPort = flags.requireNumber('clientPort');
const serverPort = flags.requireNumber('serverPort');
const project = flags.require('project');

const proc = Bun.spawn(['bun', 'run', 'dev'], {
  cwd: resolve(import.meta.dir, '../client'),
  env: {
    ...process.env,
    CLIENT_PORT: String(clientPort),
    VITE_SERVER_PORT: String(serverPort),
    VITE_PROJECT: project
  },
  stdout: 'inherit',
  stderr: 'inherit'
});
console.log(`client : http://localhost:${clientPort}/?project=${encodeURIComponent(project)} (server :${serverPort})`);

const stop = () => {
  proc.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await proc.exited;
stop();
