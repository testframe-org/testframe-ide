// Starts the framework server only - IDE module responsibility.
// All configuration arrives as parameters; this script never reads the
// root package.json. Ports/project storage must be passed by the caller.
// Usage: bun scripts/dev-server.ts --serverPort=18080 --projectsRoot=<abs dir>
import { resolve } from 'node:path';
import { parseFlags } from './args';

const flags = parseFlags(process.argv.slice(2));
const serverPort = flags.requireNumber('serverPort');
const projectsRoot = flags.require('projectsRoot');

const moduleRoot = resolve(import.meta.dir, '..');
const repoRoot = resolve(moduleRoot, '../..');

// The server build needs the assertion engine library installed
const engine = Bun.spawn(['./mvnw', '-q', 'install', '-DskipTests'], {
  cwd: resolve(repoRoot, 'modules/testframe-assert-java'),
  stdout: 'inherit',
  stderr: 'inherit'
});
if ((await engine.exited) !== 0) {
  console.error('testframe-assert-java não compilou');
  process.exit(1);
}

const server = Bun.spawn(
  ['./mvnw', '-q', 'spring-boot:run',
   `-Dspring-boot.run.arguments=--app.projects-dir=${projectsRoot} --server.port=${serverPort}`],
  {
    cwd: resolve(moduleRoot, 'server'),
    env: { ...process.env, APP_PROJECTS_DIR: projectsRoot, SERVER_PORT: String(serverPort) },
    stdout: 'inherit',
    stderr: 'inherit'
  }
);
console.log(`server : http://localhost:${serverPort} (projects em ${projectsRoot})`);

const stop = () => {
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await server.exited;
stop();
