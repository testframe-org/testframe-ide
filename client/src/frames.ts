import { z } from 'zod';
import type {
  Card,
  CardType,
  EndpointParts,
  Frame,
  FrameFile,
  PhaseKey,
  RawSource,
  ScriptFile,
  SourceDef,
  SourceScript,
  Step,
  WrappedSource
} from './types';

// ============================================================================
// PROJECT FORMAT (see modules/testframe-ide/docs/project-format.md)
//
//   {project}/testframe/
//     frames/{frame}/step-{n}/{var-file}.md         one card; var-name = camelCase(var-file)
//     sources/{type}/{name}/public-data.md           base-url + docs
//     sources/{type}/{name}/private-data.md          optional, never carries base-url
//     sources/{type}/{name}/scripts/{script-file}.md one custom query/method; name = camelCase(script-file)
//
// Identity (frame, step number, var-name, source type/name, script name) always comes
// from the path. Frontmatter stores only what the path cannot express.
// ============================================================================

// .md separators (frontmatter + body), shared by every file of a project
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

// Frame used when a project has none yet
export const DEFAULT_FRAME = 'main';

// Layout defaults: `size` is only written when a card differs from these
export const DEFAULT_CARD_SIZE: Record<CardType, { width: number; height: number }> = {
  request: { width: 320, height: 210 },
  script: { width: 320, height: 210 },
  json: { width: 290, height: 185 },
  validation: { width: 240, height: 165 }
};

export const DEFAULT_TIMEOUT: Record<CardType, number> = {
  request: 5000,
  script: 5000,
  json: 2000,
  validation: 1000
};

export const slug = (text: string): string =>
  String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';

// Variable name (camelCase) from a human title, e.g. 'Get active products' -> getActiveProducts
export const toVarName = (text: string): string => {
  const words = slug(text).split('-').filter(Boolean);
  return words
    .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('');
};

// File name is the kebab-case of the variable, e.g. getActiveProducts -> get-active-products
export const varNameToFileName = (varName: string): string =>
  varName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '') || 'card';

// Reverse of varNameToFileName: get-active-products -> getActiveProducts
export const fileNameToVarName = (fileName: string): string => toVarName(fileName.replace(/\.md$/, ''));

// Coerces user input into a var-name that survives the file-name round trip
// (camelCase, no consecutive capitals): 'getHTTP data' -> getHttpData
export const normalizeVarName = (input: string): string => fileNameToVarName(varNameToFileName(input));

const isRoundTripName = (name: string): boolean => normalizeVarName(name) === name;

const camelName = (what: string) =>
  z
    .string()
    .min(2, `${what} too short`)
    .regex(/^[a-z][a-zA-Z0-9]*$/, `${what} must be camelCase`)
    .refine(isRoundTripName, `${what} must survive the kebab-case file name (no consecutive capitals)`);

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
        name: camelName('script name'),
        body: z.string().default('')
      })
    )
    .default([])
});

// public-data.md: the only source fact the path cannot express. Unknown keys from the
// legacy format (name-source, type-source, kind, project) are ignored on load.
const sourceFrontmatterSchema = z.object({
  'base-url': z.string().optional()
});

const SOURCE_REF_RE = /^([a-z]+)(?:\/([a-z0-9][a-z0-9._-]*))?$/i;

// frames/{frame}/step-{n}/{var-file}.md
const FRAME_PATH_RE = /^([a-z0-9][a-z0-9-]*)\/step-(\d+)\/([a-z0-9][a-z0-9-]*)\.md$/;

export const cardFrontmatterSchema = z
  .object({
    title: z.string().min(1),
    type: z.enum(CARD_TYPES as [CardType, ...CardType[]]),
    phase: z.enum(['pre', 'post']),
    order: z.coerce.number().int().min(1),
    source: z
      .string()
      .regex(SOURCE_REF_RE, 'source must be {type-source} or {type-source}/{name-source}')
      .refine((ref) => (SOURCE_TYPES as readonly string[]).includes(ref.split('/')[0]), 'unknown type-source')
      .optional(),
    script: camelName('script').optional(),
    endpoint: z.string().optional(),
    timeout: z.coerce.number().int().min(100).max(120000).optional(),
    size: z
      .string()
      .regex(/^\d+x\d+$/, 'size must be {width}x{height}')
      .optional()
  })
  .refine((f) => !f.script || (f.source ?? '').includes('/'), {
    message: 'script requires source: {type-source}/{name-source}',
    path: ['script']
  });

export const defaultSourceType = (type: CardType): string =>
  ({ request: 'restapi', script: 'mongo', json: 'inline', validation: 'assert' })[type] || 'inline';

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

const hasEnvelope = (content: string): boolean => content.startsWith(FRAME_SEP) && content.includes(BODY_SEP);

const renderMd = (fields: [string, string | number | undefined][], body: string): string => {
  const lines = [FRAME_SEP];
  for (const [key, value] of fields) {
    if (value !== undefined && String(value) !== '') lines.push(`${key}: ${value}`);
  }
  lines.push(BODY_SEP);
  const text = body.replace(/\n+$/, '');
  return `${lines.join('\n')}\n${text ? `${text}\n` : ''}`;
};

// `source:` reference, e.g. mongo/products-db; inline cards carry none
export const sourceRef = (card: Pick<Card, 'sourceType' | 'sourceName'>): string | undefined => {
  const type = (card.sourceType || '').trim();
  if (!type || type === 'inline') return undefined;
  const name = (card.sourceName || '').trim();
  return name ? `${type}/${name}` : type;
};

export const findScript = (
  sources: SourceDef[],
  card: Pick<Card, 'sourceType' | 'sourceName' | 'script'>
): SourceScript | undefined => {
  if (!card.script) return undefined;
  const source = sources.find((s) => s.typeSource === card.sourceType && s.name === card.sourceName);
  return source?.scripts?.find((s) => s.name === card.script);
};

// --- CARDS: frames/{frame}/step-{n}/{var-file}.md ---
export const cardToMd = (card: Card, phase: 'pre' | 'post', order: number, sources: SourceDef[] = []): string => {
  const size = DEFAULT_CARD_SIZE[card.type];
  const customSize = card.width !== size.width || card.height !== size.height;
  // A card bound to a source script stores an empty body while it still matches the script
  const script = findScript(sources, card);
  const inherits = !!script && card.code.trim() === script.body.trim();
  return renderMd(
    [
      ['title', card.title.trim() || card.varName],
      ['type', card.type],
      ['phase', phase],
      ['order', order],
      ['source', sourceRef(card)],
      ['script', card.script || undefined],
      ['endpoint', card.endpoint.trim() || undefined],
      ['timeout', card.timeout],
      ['size', customSize ? `${card.width}x${card.height}` : undefined]
    ],
    inherits ? '' : card.code
  );
};

export const cardVarName = (card: Pick<Card, 'varName' | 'title'>): string => card.varName || toVarName(card.title);

// Serializes one frame. Throws on var-names that cannot be stored (duplicates or names
// that do not survive the kebab-case file name), since bindings rely on them.
export const buildFrameFiles = (frame: string, steps: Step[], sources: SourceDef[] = []): FrameFile[] => {
  const frameDir = slug(frame);
  const seen = new Map<string, string>();
  const files: FrameFile[] = [];
  steps.forEach((step, stepIdx) => {
    for (const phaseKey of ['preCards', 'postCards'] as PhaseKey[]) {
      step[phaseKey].forEach((card, idx) => {
        const varName = cardVarName(card);
        if (!isRoundTripName(varName)) {
          throw new Error(`var-name "${varName}" cannot be stored; use "${normalizeVarName(varName)}"`);
        }
        const where = `step ${stepIdx + 1} "${card.title}"`;
        if (seen.has(varName)) {
          throw new Error(`var-name "${varName}" is used twice (${seen.get(varName)} and ${where})`);
        }
        seen.set(varName, where);
        files.push({
          path: `${frameDir}/step-${stepIdx + 1}/${varNameToFileName(varName)}.md`,
          content: cardToMd(card, phaseKey === 'preCards' ? 'pre' : 'post', idx + 1, sources)
        });
      });
    }
  });
  return files;
};

export type CardParseResult =
  | { ok: false; errors: string[] }
  | { ok: true; frame: string; stepNumber: number; phase: 'pre' | 'post'; order: number; card: Card; warnings: string[] };

export const parseCardFile = (file: FrameFile, sources: SourceDef[] = []): CardParseResult => {
  const pathMatch = file.path.match(FRAME_PATH_RE);
  if (!pathMatch) {
    return { ok: false, errors: ['path must be {frame}/step-{n}/{var-name}.md'] };
  }
  const [, frame, stepNo, fileBase] = pathMatch;
  const { fields, code } = parseFrameMd(file.content);
  const parsed = cardFrontmatterSchema.safeParse(fields);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${[...i.path].join('.') || 'frontmatter'}: ${i.message}`)
    };
  }
  const f = parsed.data;
  const [sourceType, sourceName = ''] = (f.source ?? 'inline').split('/');
  const size = f.size?.split('x').map(Number) ?? [];
  const card: Card = {
    id: `${frame}/step-${stepNo}/${fileBase}`,
    title: f.title,
    varName: fileNameToVarName(fileBase),
    type: f.type,
    width: size[0] ?? DEFAULT_CARD_SIZE[f.type].width,
    height: size[1] ?? DEFAULT_CARD_SIZE[f.type].height,
    timeout: f.timeout ?? DEFAULT_TIMEOUT[f.type],
    status: 'idle',
    endpoint: f.endpoint ?? '',
    code,
    sourceType,
    sourceName,
    script: f.script,
    httpMethod: ''
  };
  card.httpMethod = endpointParts(card)?.method ?? '';

  const warnings: string[] = [];
  if (card.script) {
    const script = findScript(sources, card);
    if (!script) warnings.push(`script "${card.script}" not found in source ${f.source}`);
    else if (!code.trim()) card.code = script.body.replace(/\n+$/, '');
  }
  return { ok: true, frame, stepNumber: Number(stepNo), phase: f.phase, order: f.order, card, warnings };
};

// Groups the files returned by GET /api/v2/frames/{project} into frames and steps.
// `sources` resolves cards that inherit their body from a source script.
export const rebuildFrames = (files: FrameFile[], sources: SourceDef[] = []): { frames: Frame[]; errors: string[] } => {
  type Slot = { order: number; card: Card };
  const byFrame = new Map<string, Map<number, { pre: Slot[]; post: Slot[] }>>();
  const errors: string[] = [];

  for (const file of files) {
    const result = parseCardFile(file, sources);
    if (!result.ok) {
      errors.push(`${file.path}: ${result.errors.join('; ')}`);
      continue;
    }
    result.warnings.forEach((w) => errors.push(`${file.path}: ${w}`));
    const stepsOfFrame = byFrame.get(result.frame) ?? new Map();
    byFrame.set(result.frame, stepsOfFrame);
    const step = stepsOfFrame.get(result.stepNumber) ?? { pre: [], post: [] };
    stepsOfFrame.set(result.stepNumber, step);
    step[result.phase].push({ order: result.order, card: result.card });
  }

  const byOrder = (a: Slot, b: Slot) => a.order - b.order || (a.card.varName ?? '').localeCompare(b.card.varName ?? '');
  const frames: Frame[] = [...byFrame.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, stepsOfFrame]) => ({
      name,
      steps: [...stepsOfFrame.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, s], idx) => ({
          id: `step-${idx + 1}`,
          number: idx + 1,
          splitRatio: 48,
          preCards: s.pre.sort(byOrder).map((e) => e.card),
          postCards: s.post.sort(byOrder).map((e) => e.card)
        }))
    }));

  return { frames, errors };
};

// The frame to show: the requested one when it exists, else the first on disk
export const pickFrame = (frames: Frame[], preferred?: string): Frame | undefined =>
  frames.find((f) => f.name === slug(preferred ?? '')) ?? frames[0];

// --- SOURCES ---
// public-data.md frontmatter holds base-url; private-data.md and scripts/{name}.md have an
// empty frontmatter (reserved). swagger sources rely on the spec at base-url: no scripts.
export type SourceKind = 'public-data' | 'private-data';

export const hasScripts = (typeSource: string): boolean => typeSource !== 'swagger';

export const sourceToMd = (source: SourceDef, kind: SourceKind): string =>
  kind === 'public-data'
    ? renderMd([['base-url', source.baseUrl?.trim() || undefined]], source.publicData)
    : renderMd([], source.privateData);

export const scriptToMd = (script: SourceScript): string => renderMd([], script.body);

export const parseScriptFile = (file: ScriptFile): SourceScript => ({
  name: fileNameToVarName(file.file),
  body: hasEnvelope(file.content) ? parseFrameMd(file.content).code : file.content // legacy plain file
});

export const unwrapSourceMd = (content: string): { body: string; baseUrl?: string } => {
  if (!hasEnvelope(content)) return { body: content }; // legacy plain .md: keep as-is
  const { fields, code } = parseFrameMd(content);
  const parsed = sourceFrontmatterSchema.safeParse(fields);
  return { body: code, baseUrl: parsed.success ? parsed.data['base-url'] || undefined : undefined };
};

// Envelope before POST /api/v2/sources: the server stores the .md files verbatim and
// prunes stale files inside each sent source directory.
export const wrapSourcesForSave = (sources: SourceDef[]): WrappedSource[] =>
  sources.map((s) => ({
    typeSource: s.typeSource,
    name: s.name,
    baseUrl: s.baseUrl,
    publicData: sourceToMd(s, 'public-data'),
    privateData: s.privateData.trim() ? sourceToMd(s, 'private-data') : '',
    scripts: hasScripts(s.typeSource)
      ? (s.scripts ?? [])
          .filter((script) => script.body.trim())
          .map((script) => ({
            file: `${varNameToFileName(script.name)}.md`,
            content: scriptToMd(script)
          }))
      : []
  }));

// Reverse of wrapSourcesForSave after GET /api/v2/sources/{project}; identity comes from the path
export const unwrapSourcesFromLoad = (sources: RawSource[]): SourceDef[] =>
  sources.map((s) => {
    const pub = unwrapSourceMd(s.publicData ?? '');
    const priv = unwrapSourceMd(s.privateData ?? '');
    return {
      name: s.name,
      typeSource: s.typeSource,
      baseUrl: pub.baseUrl ?? priv.baseUrl,
      publicData: pub.body,
      privateData: priv.body,
      scripts: (s.scripts ?? []).map(parseScriptFile)
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
        name: 'getActiveProducts',
        body: `db.products.find({ ativo: true })
`
      },
      {
        name: 'getProductsByCategory',
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
        name: 'assertOrderTotal',
        body: `assert $sum(Account.Order.Product.(Price * Quantity)) == 336.36
`
      },
      {
        name: 'assertEchoProcessed',
        body: `assert status == "PROCESSADO"
`
      },
      {
        name: 'assertOrderHasProducts',
        body: `assert $count(Account.Order.Product) >= 1
`
      }
    ]
  }
];
