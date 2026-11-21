import { z } from 'zod';
import type {
  Card,
  CardType,
  EndpointParts,
  FrameFile,
  PhaseKey,
  RawSource,
  ScriptFile,
  SourceDef,
  SourceScript,
  Step,
  WrappedSource
} from './types';

// Frame .md separators (parameter frontmatter + code body)
export const FRAME_SEP = '-------------------';
export const BODY_SEP = '--------body----------';

export const SOURCE_TYPES = [
  'restapi',
  'swagger',
  'filter',
  'mapper',
  'assert',
  'kafka',
  'mongo',
  'oracle',
  'postgres',
  'mysql',
  'sqlserver',
  'graphql',
  'grpc',
  'inline'
] as const;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const CARD_TYPES: CardType[] = ['request', 'script', 'json', 'validation'];

export const slug = (text: string): string =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

// --- SCHEMAS (zod) ---
export const sourceSchema = z.object({
  typeSource: z.enum(SOURCE_TYPES),
  name: z
    .string()
    .min(2, 'name too short')
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'use letters, digits, dot, hyphen and underscore'),
  baseUrl: z.string().optional(),
  publicData: z.string().default(''),
  privateData: z.string().default(''),
  scripts: z
    .array(
      z.object({
        name: z
          .string()
          .min(2, 'script name too short')
          .regex(/^[a-z][a-zA-Z0-9]*$/, 'script name must be camelCase'),
        body: z.string().default('')
      })
    )
    .default([])
});

// Source .md files use the same frame contract: frontmatter + body
const sourceFrontmatterSchema = z.object({
  'name-source': z.string().min(1),
  'type-source': z.enum(SOURCE_TYPES),
  kind: z.enum(['public-data', 'private-data']),
  project: z.string().default(''),
  'base-url': z.string().default('')
});

// scripts/{name}.md frontmatter
const scriptFrontmatterSchema = z.object({
  'script-name': z.string().min(1),
  'name-source': z.string().min(1),
  'type-source': z.enum(SOURCE_TYPES),
  project: z.string().default('')
});

const frontmatterSchema = z.object({
  'card-id': z.string().min(1),
  'step-id': z.string().min(1),
  'step-number': z.coerce.number().int().min(1),
  'frame-name': z.string().min(1),
  'var-name': z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/, 'var-name must be camelCase')
    .optional(),
  'card-type': z.enum(CARD_TYPES as [CardType, ...CardType[]]),
  phase: z.enum(['pre', 'post']),
  order: z.coerce.number().int().min(0),
  'type-source': z.enum(SOURCE_TYPES),
  'type-name-source': z.string().default(''),
  'http-method': z.enum(HTTP_METHODS).optional(),
  endpoint: z.string().default(''),
  timeout: z.coerce.number().int().min(100).max(120000),
  width: z.coerce.number().int().min(120).max(900),
  height: z.coerce.number().int().min(80).max(800)
});

export type FrameParseResult =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      meta: { stepId: string; stepNumber: number; phase: 'pre' | 'post'; order: number };
      card: Card;
    };

export const defaultSourceType = (type: CardType): string =>
  ({ request: 'restapi', script: 'mongo', json: 'mapper', validation: 'assert' })[type] || 'inline';

// Variable name (camelCase) from a human title, e.g. 'Obter produtos ativos' -> obterProdutosAtivos
export const toVarName = (text: string): string => {
  const words = slug(text).split('-').filter(Boolean);
  return words
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('');
};

// File name is the kebab-case of the variable, e.g. obterProdutosAtivos -> obter-produtos-ativos.md
export const varNameToFileName = (varName: string): string =>
  varName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '') || 'frame';

// --- HELPERS ---
export const endpointParts = (card: Pick<Card, 'endpoint' | 'httpMethod'>): EndpointParts | null => {
  const trimmed = String(card.endpoint || '').trim();
  const m = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i);
  if (m) return { method: m[1].toUpperCase(), path: m[2] };
  if (card.httpMethod && trimmed.startsWith('/')) {
    return { method: String(card.httpMethod).toUpperCase(), path: trimmed };
  }
  return null;
};

export const cardToFrameMd = (card: Card, step: Step, phaseKey: PhaseKey, order: number): string => {
  const parts = endpointParts(card);
  const lines: string[] = [
    FRAME_SEP,
    `card-id: ${card.id}`,
    `step-id: ${step.id}`,
    `step-number: ${step.number}`,
    `frame-name: ${card.title}`,
    `var-name: ${card.varName || toVarName(card.title)}`,
    `card-type: ${card.type}`,
    `phase: ${phaseKey === 'preCards' ? 'pre' : 'post'}`,
    `order: ${order}`,
    `type-source: ${card.sourceType || defaultSourceType(card.type)}`,
    `type-name-source: ${card.sourceName || ''}`
  ];
  if (parts) lines.push(`http-method: ${parts.method}`);
  lines.push(
    `endpoint: ${card.endpoint}`,
    `timeout: ${card.timeout}`,
    `width: ${card.width}`,
    `height: ${card.height}`,
    BODY_SEP
  );
  return `${lines.join('\n')}\n${card.code}\n`;
};

// Structure: {project}/testframe/frames/{name-frame}/{step-id}/{card-id}.md
export const buildFrameFiles = (steps: Step[]): FrameFile[] => {
  const files: FrameFile[] = [];
  for (const step of steps) {
    for (const phaseKey of ['preCards', 'postCards'] as PhaseKey[]) {
      step[phaseKey].forEach((card, idx) => {
        const fileName = varNameToFileName(card.varName || toVarName(card.title));
        files.push({
          path: `${slug(card.title)}/${slug(step.id)}/${fileName}.md`,
          content: cardToFrameMd(card, step, phaseKey, idx + 1)
        });
      });
    }
  }
  return files;
};

export const parseFrameMd = (md: string): { fields: Record<string, string>; code: string } => {
  const bodyIdx = md.indexOf(BODY_SEP);
  const head = bodyIdx >= 0 ? md.slice(0, bodyIdx) : md;
  const code = bodyIdx >= 0 ? md.slice(bodyIdx + BODY_SEP.length).replace(/^\r?\n/, '').replace(/\n+$/, '') : '';

  const fields: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (m) fields[m[1]] = m[2];
  }
  return { fields, code };
};

export const frameMdToCard = (md: string): FrameParseResult => {
  const { fields, code } = parseFrameMd(md);
  const parsed = frontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${[...i.path].join('.') || 'frontmatter'}: ${i.message}`)
    };
  }
  const f = parsed.data;
  return {
    ok: true,
    meta: { stepId: f['step-id'], stepNumber: f['step-number'], phase: f.phase, order: f.order },
    card: {
      id: f['card-id'],
      title: f['frame-name'],
      varName: f['var-name'] || toVarName(f['frame-name']),
      type: f['card-type'],
      width: f.width,
      height: f.height,
      timeout: f.timeout,
      status: 'idle',
      endpoint: f.endpoint,
      code,
      sourceType: f['type-source'],
      sourceName: f['type-name-source'],
      httpMethod: f['http-method'] || ''
    }
  };
};

// Source .md files follow the frame contract.
// Essential frontmatter: name-source, type-source, kind, project, base-url.
// Custom queries live in scripts/{name}.md (one file per query, name = camelCase variable).
// swagger sources rely on the spec (base-url) and therefore carry no scripts.
export type SourceKind = 'public-data' | 'private-data';

export const hasScripts = (typeSource: string): boolean => typeSource !== 'swagger';

export const sourceToMd = (
  source: SourceDef,
  kind: SourceKind,
  project: string
): string => {
  const lines: string[] = [
    FRAME_SEP,
    `name-source: ${source.name}`,
    `type-source: ${source.typeSource}`,
    `kind: ${kind}`,
    `project: ${project}`,
    `base-url: ${source.baseUrl ?? ''}`,
    BODY_SEP
  ];

  const body = kind === 'public-data' ? source.publicData : source.privateData;
  return `${lines.join('\n')}\n${body}\n`;
};

export const scriptToMd = (
  source: Pick<SourceDef, 'name' | 'typeSource'>,
  script: SourceScript,
  project: string
): string =>
  [
    FRAME_SEP,
    `script-name: ${script.name}`,
    `name-source: ${source.name}`,
    `type-source: ${source.typeSource}`,
    `project: ${project}`,
    BODY_SEP,
    script.body
  ].join('\n') + '\n';

export const parseScriptMd = (
  content: string,
  fallbackName: string
): SourceScript => {
  if (!content.startsWith(FRAME_SEP) || !content.includes(BODY_SEP)) {
    return { name: fallbackName, body: content }; // legacy plain file
  }
  const { fields, code } = parseFrameMd(content);
  const parsed = scriptFrontmatterSchema.safeParse(fields);
  if (!parsed.success) return { name: fallbackName, body: content };
  return { name: parsed.data['script-name'], body: code };
};

export const unwrapSourceMd = (content: string): { body: string; meta: SourceDef | null } => {
  if (!content.startsWith(FRAME_SEP) || !content.includes(BODY_SEP)) {
    return { body: content, meta: null }; // legacy plain .md: keep as-is
  }
  const { fields, code } = parseFrameMd(content);
  const parsed = sourceFrontmatterSchema.safeParse(fields);
  if (!parsed.success) return { body: content, meta: null };
  const f = parsed.data;
  return {
    body: code,
    meta: {
      name: f['name-source'],
      typeSource: f['type-source'],
      baseUrl: f['base-url'] || undefined,
      publicData: '',
      privateData: ''
    }
  };
};

// Envelope before POST /api/v2/sources: the server stores the .md files verbatim.
// scripts/ is only written for source types that allow custom queries.
export const wrapSourcesForSave = (project: string, sources: SourceDef[]): WrappedSource[] =>
  sources.map((s) => ({
    typeSource: s.typeSource,
    name: s.name,
    baseUrl: s.baseUrl,
    publicData: sourceToMd(s, 'public-data', project),
    privateData: s.privateData.trim() ? sourceToMd(s, 'private-data', project) : '',
    scripts: hasScripts(s.typeSource)
      ? (s.scripts ?? [])
          .filter((script) => script.body.trim())
          .map((script) => ({
            file: `${varNameToFileName(script.name)}.md`,
            content: scriptToMd(s, script, project)
          }))
      : []
  }));

// Reverse of wrapSourcesForSave after GET /api/v2/sources/{project}
export const unwrapSourcesFromLoad = (sources: RawSource[]): SourceDef[] =>
  sources.map((s) => {
    const pub = unwrapSourceMd(s.publicData);
    const priv = unwrapSourceMd(s.privateData ?? '');
    const meta = pub.meta;
    return {
      name: meta?.name ?? s.name,
      typeSource: meta?.typeSource ?? s.typeSource,
      baseUrl: meta?.baseUrl,
      publicData: pub.body,
      privateData: priv.body,
      scripts: (s.scripts ?? []).map((file) =>
        parseScriptMd(file.content, file.file.replace(/\.md$/, ''))
      )
    };
  });

// --- VARIABLE BINDING: {{varName}}, {{varName.0.nome}} resolved across steps ---
const TEMPLATE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export const resolveTemplatePath = (path: string, vars: Record<string, unknown>): unknown => {
  const [head, ...rest] = path.split('.');
  let value: unknown = vars[head];
  for (const segment of rest) {
    if (value == null) return undefined;
    if (Array.isArray(value)) {
      const index = Number(segment);
      value = Number.isInteger(index) ? value[index] : undefined;
    } else if (typeof value === 'object') {
      value = (value as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return value;
};

// Walks a parsed JSON payload replacing {{...}} with values from previous cards.
export const substituteTemplates = (input: unknown, vars: Record<string, unknown>): unknown => {
  if (typeof input === 'string') {
    const whole = input.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) {
      const value = resolveTemplatePath(whole[1], vars);
      return value === undefined ? input : value;
    }
    return input.replace(TEMPLATE_RE, (match, path: string) => {
      const value = resolveTemplatePath(path, vars);
      if (value === undefined) return match;
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }
  if (Array.isArray(input)) return input.map((item) => substituteTemplates(item, vars));
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, substituteTemplates(value, vars)])
    );
  }
  return input;
};

export const rebuildSteps = (files: FrameFile[]): { steps: Step[]; errors: string[] } => {
  const byStep = new Map<
    string,
    { number: number; pre: { order: number; card: Card }[]; post: { order: number; card: Card }[] }
  >();
  const errors: string[] = [];

  for (const file of files) {
    const result = frameMdToCard(file.content);
    if (!result.ok) {
      errors.push(`${file.path}: ${result.errors.join('; ')}`);
      continue;
    }
    const { meta, card } = result;
    if (!byStep.has(meta.stepId)) {
      byStep.set(meta.stepId, { number: meta.stepNumber, pre: [], post: [] });
    }
    byStep.get(meta.stepId)![meta.phase].push({ order: meta.order, card });
  }

  const steps: Step[] = [...byStep.entries()]
    .sort((a, b) => a[1].number - b[1].number)
    .map(([id, s], idx) => ({
      id,
      number: idx + 1,
      splitRatio: 48,
      preCards: s.pre.sort((a, b) => a.order - b.order).map((e) => e.card),
      postCards: s.post.sort((a, b) => a.order - b.order).map((e) => e.card)
    }));

  return { steps, errors };
};

export const defaultSources: SourceDef[] = [
  {
    typeSource: 'restapi',
    name: 'framework-echo-api',
    baseUrl: 'http://localhost:18080',
    publicData: `# TestFrame Echo API

## Endpoints

| Method | Route           | Returns                              |
|--------|---------------|--------------------------------------|
| POST   | /echo         | 201 with request_id and echoed body  |
| GET    | /health       | service status                       |
| POST   | /frames       | writes the project .md frames        |
| GET    | /frames/{proj}| lists saved frames                   |
`,
    privateData: '',
    scripts: [
      {
        name: 'sendEcho',
        body: `await api.post('/api/v2/echo', {
  payload
})
`
      },
      {
        name: 'checkHealth',
        body: `await api.get('/api/v2/health')
`
      }
    ]
  },
  {
    typeSource: 'swagger',
    name: 'product-api',
    baseUrl: 'http://localhost:18081/api/docs/openapi.json',
    publicData: `# Product API (Swagger)

Contract source (used by the suite):

\`\`\`yaml
spec: {{base-url}}   # OpenAPI 3.1.0, endpoints match the spec 100%
\`\`\`

## Operations used by the suite

- GET /api/products
- POST /api/products
- DELETE /api/products/{id}
`,
    privateData: `# Access

Local example, no authentication.
`
  },
  {
    typeSource: 'mongo',
    name: 'products-db',
    baseUrl: 'mongodb://localhost:27017/products',
    publicData: `# products collection

Document shape (used by product-api):

\`\`\`json
{
  "_id": "ObjectId",
  "nome": "string",
  "categoria": "string",
  "preco": "number",
  "ativo": "boolean"
}
\`\`\`
`,
    privateData: '',
    scripts: [
      {
        name: 'obterProdutosAtivos',
        body: `db.products.find({ ativo: true })
`
      },
      {
        name: 'obterProdutosPorCategoria',
        body: `db.products.find({ categoria: "Ferramentas" })
`
      }
    ]
  },
  {
    typeSource: 'assert',
    name: 'assertions-core',
    baseUrl: 'http://localhost:18080/api/v2/assertions',
    publicData: `# Assertion language (JSONata subset)

\`\`\`
assert <expr> (== | != | > | >= | < | <=) <expr>
\`\`\`

Paths use JSONata semantics (\`A.B.C\`, projection \`.(Price * Quantity)\`, root \`$\`).
Functions: \`$sum\` \`$count\` \`$avg\` \`$min\` \`$max\` \`$length\` \`$number\`.
`,
    privateData: '',
    scripts: [
      {
        name: 'assertProdutosSoma',
        body: `assert $sum(Account.Order.Product.(Price * Quantity)) == 336.36
`
      },
      {
        name: 'assertProdutosQuantidade',
        body: `assert $count(Account.Order.Product) >= 1
`
      }
    ]
  }
];
