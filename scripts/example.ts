// Runs the full product-test example: the IDE (server+client) plus the example
// components (product-api, product-web). Usage: bun run dev:example
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import rootPkg from '../../../package.json' with { type: 'json' };

const ports = rootPkg.config as { serverPort: number; clientPort: number };

const root = resolve(import.meta.dir, '../../..');
const project = resolve(root, process.argv[2] ?? 'examples/product-test');
const components = resolve(project, 'examples-components');

if (!existsSync(components)) {
  console.error(`examples-components não encontrado em ${components}`);
  process.exit(1);
}

const procs: Bun.Subprocess[] = [];
const stopAll = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('uncaughtException', (err) => {
  console.error(err);
  stopAll();
});

// 1. the IDE itself, positioned at this project
procs.push(
  Bun.spawn(['bun', resolve(import.meta.dir, 'dev.ts'), project], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit'
  })
);

// 2. product-api — requires MongoDB local (mongodb://localhost:27017/products)
const apiDir = resolve(components, 'product-api');
if (existsSync(apiDir)) {
  procs.push(
    Bun.spawn(['./mvnw', '-q', 'spring-boot:run'], {
      cwd: apiDir,
      stdout: 'inherit',
      stderr: 'inherit'
    })
  );
}

// 3. product-web
const webDir = resolve(components, 'product-web');
if (existsSync(webDir)) {
  if (!existsSync(resolve(webDir, 'node_modules'))) {
    console.log('instalando dependências do product-web...');
    await Bun.spawn(['bun', 'install'], { cwd: webDir, stdout: 'inherit' }).exited;
  }
  procs.push(
    Bun.spawn(['bun', 'run', 'dev'], {
      cwd: webDir,
      stdout: 'inherit',
      stderr: 'inherit'
    })
  );
}

console.log('');
console.log('exemplo  :', project.split('/').pop());
console.log(`testframe: http://localhost:${ports.clientPort}`);
console.log('api      : http://localhost:18081/swagger-ui.html');
console.log('web      : http://localhost:15174');
console.log('');

await Promise.race(procs.map((p) => p.exited));
stopAll();
