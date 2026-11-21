// TestFrame IDE runner.
// Usage: bun run dev [./examples/<project>]   (paths resolve against the repo root)
// Ports come from the repo-root package.json > config (or SERVER_PORT / CLIENT_PORT).
// Builds/installs the java jsonata engine, starts the framework server with its
// project storage pointed at the given folder, waits for health, then starts the
// Vite client positioned at the project (VITE_PROJECT).
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import rootPkg from '../../../package.json' with { type: 'json' };

const ports = rootPkg.config as { serverPort: number; clientPort: number };
const serverPort = Number(process.env.SERVER_PORT ?? ports.serverPort);
const clientPort = Number(process.env.CLIENT_PORT ?? ports.clientPort);

const root = resolve(import.meta.dir, '../../..');
const target = resolve(root, process.argv[2] ?? 'examples/product-test');
if (!existsSync(target)) {
  console.error(`pasta do projeto não encontrada: ${target}`);
  process.exit(1);
}
mkdirSync(resolve(target, 'testframe'), { recursive: true });

const project = basename(target);
const projectsRoot = dirname(target);

console.log(`projeto  : ${project}`);
console.log(`server   : Spring Boot :${serverPort} (projects em ${projectsRoot})`);
console.log(`client   : Vite :${clientPort}          (projeto ${project})`);
console.log(`frames   -> ${target}/testframe/frames`);
console.log(`sources  -> ${target}/testframe/sources\n`);

// Build/install the assertion engine library consumed by the server module
const engine = Bun.spawn(['./mvnw', '-q', 'install', '-DskipTests'], {
  cwd: resolve(root, 'modules/testframe-assert-java'),
  stdout: 'inherit',
  stderr: 'inherit'
});
if ((await engine.exited) !== 0) {
  console.error('testframe-assert-java não compilou');
  process.exit(1);
}

const server = Bun.spawn(
  [
    './mvnw',
    '-q',
    'spring-boot:run',
    `-Dspring-boot.run.arguments=--app.projects-dir=${projectsRoot} --server.port=${serverPort}`
  ],
  {
    cwd: resolve(root, 'modules/testframe-ide/server'),
    env: { ...process.env, APP_PROJECTS_DIR: projectsRoot, SERVER_PORT: String(serverPort) },
    stdout: 'inherit',
    stderr: 'inherit'
  }
);

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try {
    const res = await fetch(`http://localhost:${serverPort}/api/v2/health`);
    up = res.ok;
  } catch {
    await Bun.sleep(1000);
  }
}

if (!up) {
  console.error(`testframe-server não respondeu em http://localhost:${serverPort}`);
  server.kill();
  process.exit(1);
}
console.log(`✔ testframe-server ativo em http://localhost:${serverPort}`);

const client = Bun.spawn(['bun', 'run', 'dev'], {
  cwd: resolve(root, 'modules/testframe-ide/client'),
  env: {
    ...process.env,
    CLIENT_PORT: String(clientPort),
    VITE_SERVER_PORT: String(serverPort),
    VITE_PROJECT: project
  },
  stdout: 'inherit',
  stderr: 'inherit'
});

const stop = () => {
  server.kill();
  client.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await Promise.race([server.exited, client.exited]);
stop();
