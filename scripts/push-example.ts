// Pushes the seed example project (frames + sources) to the running framework server.
// Usage: bun run example:push
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFrameFiles,
  defaultSources,
  substituteTemplates,
  wrapSourcesForSave
} from '../client/src/frames';
import type { Step } from '../client/src/types';

const base = process.env.BASE_URL ?? 'http://localhost:18080';
const project = 'product-test';
const framesDir = resolve(import.meta.dir, '../../..', 'examples', project, 'testframe/frames');

const steps: Step[] = [
  {
    id: 'step-1',
    number: 1,
    splitRatio: 46,
    preCards: [
      {
        id: 'card-1-pre-1',
        title: 'Obter produtos ativos',
        varName: 'obterProdutosAtivos',
        type: 'script',
        width: 340,
        height: 290,
        timeout: 5000,
        status: 'idle',
        endpoint: 'db.products.find({ ativo: true })',
        sourceType: 'mongo',
        sourceName: 'products-db',
        httpMethod: '',
        code: `// Custom query from products-db (scripts/obter-produtos-ativos.md)
const products = await db
  .collection('products')
  .find({ ativo: true })
  .toArray();

return products.map((p) => ({
  id: String(p._id),
  nome: p.nome,
  categoria: p.categoria,
  preco: p.preco
}));`
      }
    ],
    postCards: [
      {
        id: 'card-1-post-1',
        title: 'Active products result',
        varName: 'produtosAtivos',
        type: 'json',
        width: 310,
        height: 195,
        timeout: 2000,
        status: 'idle',
        endpoint: '200 OK',
        sourceType: 'inline',
        sourceName: 'resultado-step1',
        httpMethod: '',
        code: `[
  {
    "id": "6b01da00670c5ef91d82bb42",
    "nome": "Kit Testes E2E",
    "categoria": "Ferramentas",
    "preco": 480
  },
  {
    "id": "6b01da00670c5ef91d82bb43",
    "nome": "Licenca TestFrame",
    "categoria": "Software",
    "preco": 1290
  }
]`
      },
      {
        id: 'card-1-post-2',
        title: 'Assert active products',
        varName: 'assertProdutosAtivos',
        type: 'validation',
        width: 210,
        height: 135,
        timeout: 1000,
        status: 'idle',
        endpoint: 'Chai/Jest assertion',
        sourceType: 'assert',
        sourceName: 'assertions-core',
        httpMethod: '',
        code: `assert $count(produtosAtivos) > 0`
      }
    ]
  },
  {
    id: 'step-2',
    number: 2,
    splitRatio: 52,
    preCards: [
      {
        id: 'card-2-pre-1',
        title: 'Payload entrada',
        varName: 'payloadEcho',
        type: 'json',
        width: 195,
        height: 150,
        timeout: 1000,
        status: 'idle',
        endpoint: 'Input Binding',
        sourceType: 'mapper',
        sourceName: 'payload-step2',
        httpMethod: '',
        code: `{
  "produtos": "{{obterProdutosAtivos}}",
  "primeiro": "{{obterProdutosAtivos.0.nome}}",
  "competencia": "2026-11"
}`
      },
      {
        id: 'card-2-pre-2',
        title: 'Executar teste no echo do framework',
        varName: 'executarEcho',
        type: 'request',
        width: 360,
        height: 300,
        timeout: 8000,
        status: 'idle',
        endpoint: 'POST /api/v2/echo',
        sourceType: 'restapi',
        sourceName: 'framework-echo-api',
        httpMethod: 'POST',
        code: `// Sends the bound payload to the framework echo endpoint
const response = await api.post('/api/v2/echo', payloadEcho);

return response.data;`
      }
    ],
    postCards: [
      {
        id: 'card-2-post-1',
        title: 'Echo result',
        varName: 'resultadoEcho',
        type: 'json',
        width: 310,
        height: 195,
        timeout: 2000,
        status: 'idle',
        endpoint: '201 Created',
        sourceType: 'inline',
        sourceName: 'resultado-step2',
        httpMethod: '',
        code: `{
  "request_id": "REQ-1",
  "status": "PROCESSADO",
  "echo": {}
}`
      },
      {
        id: 'card-2-post-2',
        title: 'Validar echo',
        varName: 'validarEcho',
        type: 'validation',
        width: 190,
        height: 135,
        timeout: 1000,
        status: 'idle',
        endpoint: 'Filter & Rule',
        sourceType: 'assert',
        sourceName: 'assertions-core',
        httpMethod: '',
        code: `assert $count(produtosAtivos) != 0`
      }
    ]
  }
];

// start from a clean frames directory so removed cards do not linger
rmSync(framesDir, { recursive: true, force: true });

let res = await fetch(`${base}/api/v2/frames`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, files: buildFrameFiles(steps) })
});
console.log('frames:', res.status, await res.json());

res = await fetch(`${base}/api/v2/sources`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, sources: wrapSourcesForSave(project, defaultSources) })
});
console.log('sources:', res.status, await res.json());

res = await fetch(`${base}/api/v2/sources/${project}`);
const loaded = await res.json();
console.log(
  'sources roundtrip:',
  loaded.sources.map((s: { typeSource: string; name: string; scripts?: { file: string }[] }) =>
    `${s.typeSource}/${s.name} scripts=[${(s.scripts ?? []).map((f: { file: string }) => f.file).join(', ')}]`
  )
);

// variable binding sanity: step 2 payload resolves step 1 output
const produtos = JSON.parse(steps[0].postCards[0].code);
const payload = JSON.parse(steps[1].preCards[0].code);
console.log('substitution:', JSON.stringify(substituteTemplates(payload, { obterProdutosAtivos: produtos })));
