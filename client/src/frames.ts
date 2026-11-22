import { z } from 'zod';
import type {
  Card,
  CardRunResult,
  CardType,
  EndpointParts,
  Frame,
  FrameFile,
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
//     frames/{frame}/step-{n}/{var-file}.md          one card; var-name = camelCase(var-file)
//     frames/{frame}/step-{n}/{var-file}.private.md  optional private data of that card
//     sources/{type}/{name}.md                        base-url + docs
//     sources/{type}/{name}.private.md                optional private data, never carries base-url
//     sources/{type}/{name}/{script-file}.md          one custom query/method; name = camelCase(script-file)
//
//   *.private.md files are gitignored; a versioned *.private.example.md next to them is the
//   template loaded when the private file is missing (the server never deletes templates).
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

// --- CODE RULES PER SOURCE TYPE ---
// mongo: one mongo shell call; oracle: one SELECT; assert: jsonassert lines only.
// Returns the problem, or null when the code is acceptable (empty code is a draft: allowed).
const MONGO_OPS = ['find', 'findOne', 'aggregate', 'countDocuments', 'distinct'];
const MONGO_CALL_RE = /^db\.[A-Za-z_$][\w$-]*\.([A-Za-z]+)\s*\(/;
const ASSERT_LINE_RE = /^assert\s+.+\s(==|!=|>=|<=|>|<)\s.+$/;

const stripLineComments = (code: string, marker: string): string =>
  code
    .split('\n')
    .filter((line) => !line.trim().startsWith(marker))
    .join('\n')
    .trim();

const balanced = (text: string): boolean => {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (--depth < 0) return false;
    }
  }
  return depth === 0 && !quote;
};

export const validateSourceCode = (sourceType: string, code: string): string | null => {
  switch (sourceType) {
    case 'mongo': {
      const body = stripLineComments(code, '//');
      if (!body) return null;
      const m = body.match(MONGO_CALL_RE);
      if (!m) return 'mongo cards accept one mongo shell call, e.g. db.products.find({ ativo: true })';
      if (!MONGO_OPS.includes(m[1]!)) return `mongo operation "${m[1]}" is not allowed (${MONGO_OPS.join(', ')})`;
      if (!balanced(body)) return 'unbalanced brackets or quotes';
      const tail = body.replace(/;\s*$/, '');
      if (!tail.endsWith(')')) return 'the mongo call must end with ")"';
      if (/;/.test(tail.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) return 'only one mongo call is allowed';
      return null;
    }
    case 'oracle': {
      const body = stripLineComments(code, '--');
      if (!body) return null;
      if (!/^select\b/i.test(body)) return 'oracle cards accept a single SELECT statement';
      const statement = body.replace(/;\s*$/, '');
      if (/;/.test(statement.replace(/'(?:''|[^'])*'/g, ''))) return 'only one SELECT statement is allowed';
      return null;
    }
    case 'assert': {
      const lines = code.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
      const bad = lines.find((l) => !ASSERT_LINE_RE.test(l));
      return bad ? `not a jsonassert line: ${bad}` : null;
    }
    default:
      return null;
  }
};

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
}).superRefine((source, ctx) => {
  source.scripts.forEach((script, i) => {
    const problem = validateSourceCode(source.typeSource, script.body);
    if (problem) ctx.addIssue({ code: 'custom', path: ['scripts', i, 'body'], message: `${script.name}: ${problem}` });
  });
});

// {name}.md frontmatter: base-url is the only source fact the path cannot express.
const sourceFrontmatterSchema = z.object({
  'base-url': z.string().optional()
});

const SOURCE_REF_RE = /^([a-z]+)(?:\/([a-z0-9][a-z0-9._-]*))?$/i;

// frames/{frame}/step-{n}/{var-file}.md
const FRAME_PATH_RE = /^([a-z0-9][a-z0-9-]*)\/step-(\d+)\/([a-z0-9][a-z0-9-]*)\.md$/;
// frames/{frame}/step-{n}/{var-file}.private.md | .private.example.md
const PRIVATE_PATH_RE = /^([a-z0-9][a-z0-9-]*\/step-\d+\/[a-z0-9][a-z0-9-]*)\.private(\.example)?\.md$/;
export const PRIVATE_SUFFIX = '.private.md';
// frames/{frame}/step-{n}/{var-file}.result-data.md: last run of that card (gitignored)
export const RESULT_SUFFIX = '.result-data.md';
const RESULT_PATH_RE = /^([a-z0-9][a-z0-9-]*\/step-\d+\/[a-z0-9][a-z0-9-]*)\.result-data\.md$/;
export const PRIVATE_EXAMPLE_SUFFIX = '.private.example.md';

export const cardFrontmatterSchema = z
  .object({
    title: z.string().min(1),
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
      .optional(),
    'result-height': z.coerce.number().int().min(24).max(600).optional()
  })
  .refine((f) => !f.script || (f.source ?? '').includes('/'), {
    message: 'script requires source: {type-source}/{name-source}',
    path: ['script']
  });

// The card type is never stored nor picked: it follows the card's source type
// (it drives the default size/timeout and how the card runs).
export const cardTypeOf = (sourceType: string): CardType => {
  switch (sourceType) {
    case 'restapi':
    case 'graphql':
    case 'swagger':
      return 'request';
    case 'assert':
      return 'validation';
    case 'inline':
    case '':
      return 'json';
    default:
      return 'script'; // mongo, SQL types, filter, mapper, kafka, grpc
  }
};

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
export const cardToMd = (card: Card, order: number, sources: SourceDef[] = []): string => {
  const size = DEFAULT_CARD_SIZE[card.type];
  const customSize = card.width !== size.width || card.height !== size.height;
  // A card bound to a source script stores an empty body while it still matches the script
  const script = findScript(sources, card);
  const inherits = !!script && card.code.trim() === script.body.trim();
  return renderMd(
    [
      ['title', card.title.trim() || card.varName],
      ['order', order],
      ['source', sourceRef(card)],
      ['script', card.script || undefined],
      ['endpoint', card.endpoint.trim() || undefined],
      ['timeout', card.timeout],
      ['size', customSize ? `${card.width}x${card.height}` : undefined],
      ['result-height', card.resultHeight]
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
    step.cards.forEach((card, idx) => {
        const varName = cardVarName(card);
        if (!isRoundTripName(varName)) {
          throw new Error(`var-name "${varName}" cannot be stored; use "${normalizeVarName(varName)}"`);
        }
        const where = `step ${stepIdx + 1} "${card.title}"`;
        if (seen.has(varName)) {
          throw new Error(`var-name "${varName}" is used twice (${seen.get(varName)} and ${where})`);
        }
        seen.set(varName, where);
        const problem = validateSourceCode(card.sourceType, card.code);
        if (problem) throw new Error(`${where}: ${problem}`);
        const base = `${frameDir}/step-${stepIdx + 1}/${varNameToFileName(varName)}`;
        files.push({
          path: `${base}.md`,
          content: cardToMd(card, idx + 1, sources)
        });
        if (card.privateData?.trim()) {
          files.push({ path: `${base}${PRIVATE_SUFFIX}`, content: renderMd([], card.privateData) });
        }
    });
  });
  return files;
};

export type CardParseResult =
  | { ok: false; errors: string[] }
  | { ok: true; frame: string; stepNumber: number; order: number; card: Card; warnings: string[] };

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
  const type = cardTypeOf(sourceType);
  const card: Card = {
    id: `${frame}/step-${stepNo}/${fileBase}`,
    title: f.title,
    varName: fileNameToVarName(fileBase),
    type,
    width: size[0] ?? DEFAULT_CARD_SIZE[type].width,
    height: size[1] ?? DEFAULT_CARD_SIZE[type].height,
    timeout: f.timeout ?? DEFAULT_TIMEOUT[type],
    status: 'idle',
    endpoint: f.endpoint ?? '',
    code,
    sourceType,
    sourceName,
    script: f.script,
    resultHeight: f['result-height'],
    httpMethod: ''
  };
  card.httpMethod = endpointParts(card)?.method ?? '';

  const warnings: string[] = [];
  if (card.script) {
    const script = findScript(sources, card);
    if (!script) warnings.push(`script "${card.script}" not found in source ${f.source}`);
    else if (!code.trim()) card.code = script.body.replace(/\n+$/, '');
  }
  return { ok: true, frame, stepNumber: Number(stepNo), order: f.order, card, warnings };
};

// Groups the files returned by GET /api/v2/frames/{project} into frames and steps.
// `sources` resolves cards that inherit their body from a source script.
// Path of a card without extension, relative to frames/: {frame}/step-{n}/{var-file}
export const cardBasePath = (frame: string, stepNumber: number, card: Pick<Card, 'varName' | 'title'>): string =>
  `${slug(frame)}/step-${stepNumber}/${varNameToFileName(cardVarName(card))}`;

export const resultToMd = (result: CardRunResult): string =>
  renderMd(
    [
      ['status', result.status],
      ['ran-at', result.ranAt],
      ['elapsed', result.at],
      ['summary', result.text.replace(/\s+/g, ' ')]
    ],
    result.output
  );

const parseResultMd = (content: string): CardRunResult => {
  const { fields, code } = parseFrameMd(content);
  const status = fields.status === 'success' || fields.status === 'error' ? fields.status : 'idle';
  return { status, text: fields.summary ?? '', output: code, at: fields.elapsed ?? '', ranAt: fields['ran-at'] };
};

export const rebuildFrames = (
  files: FrameFile[],
  sources: SourceDef[] = []
): { frames: Frame[]; errors: string[]; results: Record<string, CardRunResult> } => {
  type Slot = { order: number; card: Card };
  const byFrame = new Map<string, Map<number, Slot[]>>();
  const errors: string[] = [];

  // Private files first: {base} -> body, a real .private.md wins over its .private.example.md
  const privates = new Map<string, { body: string; example: boolean }>();
  const resultsByBase = new Map<string, CardRunResult>();
  const cardFiles: FrameFile[] = [];
  for (const file of files) {
    const r = file.path.match(RESULT_PATH_RE);
    if (r) {
      resultsByBase.set(r[1], parseResultMd(file.content));
      continue;
    }
    const m = file.path.match(PRIVATE_PATH_RE);
    if (!m) {
      cardFiles.push(file);
      continue;
    }
    const example = !!m[2];
    const current = privates.get(m[1]);
    if (!current || (current.example && !example)) {
      privates.set(m[1], { body: parseFrameMd(file.content).code, example });
    }
  }
  const claimed = new Set<string>();
  const results: Record<string, CardRunResult> = {};

  for (const file of cardFiles) {
    const result = parseCardFile(file, sources);
    if (!result.ok) {
      errors.push(`${file.path}: ${result.errors.join('; ')}`);
      continue;
    }
    result.warnings.forEach((w) => errors.push(`${file.path}: ${w}`));
    const base = file.path.replace(/\.md$/, '');
    const last = resultsByBase.get(base);
    if (last) results[result.card.id] = last;
    const priv = privates.get(base);
    if (priv) {
      result.card.privateData = priv.body;
      claimed.add(base);
    }
    const stepsOfFrame = byFrame.get(result.frame) ?? new Map();
    byFrame.set(result.frame, stepsOfFrame);
    const step: Slot[] = stepsOfFrame.get(result.stepNumber) ?? [];
    stepsOfFrame.set(result.stepNumber, step);
    step.push({ order: result.order, card: result.card });
  }

  for (const base of privates.keys()) {
    if (!claimed.has(base)) errors.push(`${base}: private data without a card (${base}.md missing)`);
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
          cards: s.sort(byOrder).map((e) => e.card)
        }))
    }));

  return { frames, errors, results };
};

// The frame to show: the requested one when it exists, else the first on disk
export const pickFrame = (frames: Frame[], preferred?: string): Frame | undefined =>
  frames.find((f) => f.name === slug(preferred ?? '')) ?? frames[0];

// --- SOURCES ---
// {name}.md frontmatter holds base-url; {name}.private.md and {name}/{script}.md have an
// empty frontmatter (reserved). swagger sources rely on the spec at base-url: no scripts.
export type SourceKind = 'public' | 'private';

export const hasScripts = (typeSource: string): boolean => typeSource !== 'swagger';

export const sourceToMd = (source: SourceDef, kind: SourceKind): string =>
  kind === 'public'
    ? renderMd([['base-url', source.baseUrl?.trim() || undefined]], source.publicData)
    : renderMd([], source.privateData);

export const scriptToMd = (script: SourceScript): string => renderMd([], script.body);

export const parseScriptFile = (file: ScriptFile): SourceScript => ({
  name: fileNameToVarName(file.file),
  body: parseFrameMd(file.content).code
});

export const unwrapSourceMd = (content: string): { body: string; baseUrl?: string } => {
  const { fields, code } = parseFrameMd(content);
  const parsed = sourceFrontmatterSchema.safeParse(fields);
  return { body: code, baseUrl: parsed.success ? parsed.data['base-url'] || undefined : undefined };
};

// Envelope before POST /api/v2/sources: the server stores the .md files verbatim as
// {type}/{name}.md, {type}/{name}.private.md and {type}/{name}/{script}.md, pruning stale ones.
export const wrapSourcesForSave = (sources: SourceDef[]): WrappedSource[] =>
  sources.map((s) => ({
    typeSource: s.typeSource,
    name: s.name,
    baseUrl: s.baseUrl,
    publicData: sourceToMd(s, 'public'),
    privateData: s.privateData.trim() ? sourceToMd(s, 'private') : '',
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
