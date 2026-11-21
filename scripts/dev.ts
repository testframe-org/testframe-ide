// Starts server+client together - IDE module responsibility.
// Usage: bun scripts/dev.ts --serverPort=18080 --clientPort=15173 --projectsRoot=<dir> --project=<name>
import { parseFlags } from './args';

const flags = parseFlags(process.argv.slice(2));
const serverPort = flags.require('serverPort');
const clientPort = flags.require('clientPort');
const projectsRoot = flags.require('projectsRoot');
const project = flags.require('project');

const server = Bun.spawn(
  ['bun', new URL('dev-server.ts', import.meta.url).pathname, `--serverPort=${serverPort}`, `--projectsRoot=${projectsRoot}`],
  { stdout: 'inherit', stderr: 'inherit' }
);
const client = Bun.spawn(
  ['bun', new URL('dev-client.ts', import.meta.url).pathname, `--clientPort=${clientPort}`, `--serverPort=${serverPort}`, `--project=${project}`],
  { stdout: 'inherit', stderr: 'inherit' }
);

const stop = () => {
  server.kill();
  client.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.race([server.exited, client.exited]);
stop();
