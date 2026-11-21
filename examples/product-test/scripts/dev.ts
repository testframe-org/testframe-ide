// Runs the example app components (product-api + product-web).
// Every setting arrives as a parameter; the repo-root scripts resolve them
// from package.json > config.examples["product-test"] (+ --config.* flags).
// Run standalone, the documented defaults apply.
// Usage: bun run dev [--api-only | --web-only] [--serverPort=N] [--clientPort=N] [--mongoUri=URI]
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const param = (key: string): string | undefined =>
  args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const cfg = {
  serverPort: Number(param('serverPort') ?? 18081),
  clientPort: Number(param('clientPort') ?? 15174),
  mongoUri: param('mongoUri') ?? 'mongodb://localhost:27017/products'
};
for (const key of ['serverPort', 'clientPort'] as const) {
  if (!Number.isInteger(cfg[key])) {
    console.error(`--${key} must be a number, got: ${param(key)}`);
    process.exit(1);
  }
}

const components = resolve(root, 'examples-components');
const mode = args.find((a) => a === '--api-only' || a === '--web-only') ?? '';

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
      env: { ...process.env, SERVER_PORT: String(cfg.serverPort), SPRING_MONGODB_URI: cfg.mongoUri },
      stdout: 'inherit',
      stderr: 'inherit'
    })
  );
  console.log(`api      : http://localhost:${cfg.serverPort}/swagger-ui.html (mongo: ${cfg.mongoUri})`);
}

if (mode !== '--api-only' && existsSync(webDir)) {
  if (!existsSync(resolve(webDir, 'node_modules'))) {
    console.log('installing product-web dependencies...');
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
  console.error(`no components found at ${components}`);
  process.exit(1);
}

await Promise.race(procs.map((p) => p.exited));
stopAll();
