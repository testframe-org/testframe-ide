// End-to-end smoke for the framework server: health, echo, assertion engine,
// frames round-trip, sources round-trip, path-traversal protection.
// Uses an ephemeral project (examples/smoke-tmp) so real example projects are
// never touched. Run with the stack up: bun run smoke
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFrameFiles, rebuildSteps, wrapSourcesForSave } from '../client/src/frames';
import rootPkg from '../../../package.json' with { type: 'json' };
import type { Step } from '../client/src/types';

const ports = rootPkg.config as { serverPort: number; clientPort: number };
const root = resolve(import.meta.dir, '../../..');
const base = process.env.BASE_URL ?? `http://localhost:${process.env.SERVER_PORT ?? ports.serverPort}`;
const project = 'smoke-tmp';

const steps: Step[] = [
  {
    id: 'step-1',
    number: 1,
    splitRatio: 46,
    preCards: [{
      id: 'card-1-pre-1', title: 'Ping echo', varName: 'pingEcho', type: 'request',
      width: 340, height: 290, timeout: 5000, status: 'idle',
      endpoint: 'POST /api/v2/echo', code: "await api.post('/api/v2/echo', {})",
      sourceType: 'restapi', sourceName: 'framework-echo-api', httpMethod: 'POST'
    }],
    postCards: []
  }
];

let res = await fetch(`${base}/api/v2/health`);
console.log('health:', res.status, (await res.json()).status);

res = await fetch(`${base}/api/v2/echo`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ smoke: true })
});
console.log('echo:', res.status);

res = await fetch(`${base}/api/v2/assertions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    expression: 'assert $sum(Account.Order.Product.(Price * Quantity)) == 336.36',
    input: { Account: { Order: { Product: [
      { Price: 59.99, Quantity: 2 }, { Price: 24.99, Quantity: 3 },
      { Price: 45.0, Quantity: 2 }, { Price: 51.41, Quantity: 1 }
    ] } } }
  })
});
const asserted = await res.json();
console.log('assertion:', res.status, 'passed =', asserted.passed, '| jsonata =', asserted.jsonata);

res = await fetch(`${base}/api/v2/frames`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, files: buildFrameFiles(steps) })
});
console.log('save frames:', res.status, 'saved =', (await res.json()).saved);

res = await fetch(`${base}/api/v2/frames/${project}`);
const loaded = await res.json();
const rebuilt = rebuildSteps(loaded.files);
console.log('frames roundtrip ok:', rebuilt.steps.length === 1 && rebuilt.errors.length === 0
  && rebuilt.steps[0].preCards[0].varName === 'pingEcho');

res = await fetch(`${base}/api/v2/sources`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, sources: wrapSourcesForSave(project, [{
    typeSource: 'mongo', name: 'smoke-db', baseUrl: 'mongodb://localhost:27017/smoke',
    publicData: '# smoke\n', privateData: '', scripts: [{ name: 'smokeQuery', body: 'db.x.find()\n' }]
  }]) })
});
console.log('save sources:', res.status, 'saved =', (await res.json()).saved);

res = await fetch(`${base}/api/v2/sources/${project}`);
const sourcesLoaded = await res.json();
console.log('sources roundtrip ok:',
  sourcesLoaded.sources[0]?.scripts?.[0]?.file === 'smoke-query.md');

res = await fetch(`${base}/api/v2/frames`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, files: [{ path: '../../etc/passwd.md', content: 'x' }] })
});
console.log('path traversal blocked:', res.status === 400);

rmSync(resolve(root, 'examples', project), { recursive: true, force: true });
console.log('cleanup: examples/smoke-tmp removed');
