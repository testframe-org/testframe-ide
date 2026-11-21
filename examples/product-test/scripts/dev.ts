// Runs the example app components. Ports come from the REPO-ROOT
// package.json > config.examples["product-test"] (single source of truth),
// falling back to the documented defaults.
// Usage: bun run dev [--api-only | --web-only]
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import rootPkg from '../../../package.json' with { type: 'json' };

const root = resolve(import.meta.dir, '..');
const projectName = basename(root);
const cfg = ((rootPkg.config as Record<string, unknown>).examples as
  Record<string, { serverPort: number; clientPort: number; mongoUri?: string }>)[projectName]
  ?? { serverPort: 18081, clientPort: 15174, mongoUri: 'mongodb://localhost:27017/products' };

const components = resolve(root, 'examples-components');
const mode = process.argv[2] ?? '';

const procs: Bun.Subprocess[] = [];
const stopAll = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const apiDir = resolve(components, 'product-api');
const webDir = resolve(components, 'product-web');

if (mode !== '--web-only' && existsSync(apiDir)) {
  procs.push(
    Bun.spawn(['./mvnw', '-q', 'spring-boot:run'], {
      cwd: apiDir,
      env: { ...process.env, SERVER_PORT: String(cfg.serverPort) },
      stdout: 'inherit',
      stderr: 'inherit'
    })
  );
  console.log(`api      : http://localhost:${cfg.serverPort}/swagger-ui.html (mongo: ${cfg.mongoUri})`);
}

if (mode !== '--api-only' && existsSync(webDir)) {
  if (!existsSync(resolve(webDir, 'node_modules'))) {
    console.log('instalando dependências do product-web...');
    await Bun.spawn(['bun', 'install'], { cwd: webDir, stdout: 'inherit' }).exited;
  }
  procs.push(
    Bun.spawn(['bun', 'run', 'dev'], {
      cwd: webDir,
      env: {
        ...process.env,
        CLIENT_PORT: String(cfg.clientPort),
        API_PORT: String(cfg.serverPort)
      },
      stdout: 'inherit',
      stderr: 'inherit'
    })
  );
  console.log(`web      : http://localhost:${cfg.clientPort}`);
}

if (procs.length === 0) {
  console.error(`nenhum componente encontrado em ${components}`);
  process.exit(1);
}

await Promise.race(procs.map((p) => p.exited));
stopAll();
