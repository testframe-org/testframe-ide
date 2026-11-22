import type { Card, CardData, CardRunResult, CardType, EndpointParts, Frame, FrameData, FramesLoadResponse, Step } from './types';

// ============================================================================
// The project format (.md files, frontmatter, file names, script inheritance, validation of
// what is stored) is owned by the framework server (server/.../format, spec:
// modules/testframe-ide/docs/project-format.md). The API exchanges structured JSON; this module
// keeps the editor's in-memory model plus the rules the UI still needs locally.
// ============================================================================

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

// Card defaults per type, mirrored from the server's format/Catalog until Phase 2 serves them
export const DEFAULT_CARD_SIZE: Record<CardType, { width: number; height: number }> = {
  request: { width: 320, height: 210 },
  js: { width: 320, height: 210 },
  sql: { width: 320, height: 210 },
  jsonassert: { width: 300, height: 190 },
  json: { width: 290, height: 185 },
  validation: { width: 240, height: 165 }
};

export const DEFAULT_TIMEOUT: Record<CardType, number> = {
  request: 5000,
  js: 5000,
  sql: 5000,
  jsonassert: 2000,
  json: 2000,
  validation: 1000
};

// --- NAMES (mirror of the server's format/Names: the server enforces them on save; the editor
// uses them for new cards, the storage directory and live var-name feedback) ---
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
    case 'oracle':
    case 'postgres':
    case 'mysql':
    case 'sqlserver':
      return 'sql';
    case 'filter':
    case 'mapper':
      return 'jsonassert';
    case 'inline':
    case '':
      return 'json';
    default:
      return 'js'; // mongo (shell JS), kafka, grpc
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

// The frame to show: the requested one when it exists, else the first on disk
export const pickFrame = (frames: Frame[], preferred?: string): Frame | undefined =>
  frames.find((f) => f.name === slug(preferred ?? '')) ?? frames[0];

// swagger sources rely on the OpenAPI spec at base-url: no scripts
export const hasScripts = (typeSource: string): boolean => typeSource !== 'swagger';

// --- IN-MEMORY MODEL <-> API (GET/POST /api/v2/frames) ---
export const cardVarName = (card: Pick<Card, 'varName' | 'title'>): string => card.varName || toVarName(card.title);

// Card ids are editor-only: {frame}/step-{n}/{var-file}
const toCard = (frame: string, stepNumber: number, d: CardData): Card => ({
  id: `${frame}/step-${stepNumber}/${varNameToFileName(d.varName)}`,
  title: d.title,
  varName: d.varName,
  type: d.type as CardType,
  width: d.width ?? DEFAULT_CARD_SIZE[d.type as CardType].width,
  height: d.height ?? DEFAULT_CARD_SIZE[d.type as CardType].height,
  timeout: d.timeout ?? DEFAULT_TIMEOUT[d.type as CardType],
  status: 'idle',
  endpoint: d.endpoint ?? '',
  code: d.code ?? '',
  sourceType: d.sourceType ?? 'inline',
  sourceName: d.sourceName ?? '',
  script: d.script ?? undefined,
  resultHeight: d.resultHeight ?? undefined,
  privateData: d.privateData ?? undefined,
  httpMethod: d.httpMethod ?? ''
});

// Frames as loaded by the server, with the last run of each card keyed by card id
export const framesFromApi = (
  data: FramesLoadResponse
): { frames: Frame[]; errors: string[]; results: Record<string, CardRunResult> } => {
  const results: Record<string, CardRunResult> = {};
  const frames = data.frames.map((frame) => ({
    name: frame.name,
    steps: frame.steps.map((step, idx) => ({
      id: `step-${idx + 1}`,
      number: idx + 1,
      cards: step.cards.map((d) => {
        const card = toCard(frame.name, idx + 1, d);
        if (d.lastRun) {
          const { status, text, output, at, ranAt } = d.lastRun;
          results[card.id] = { status, text, output, at, ranAt: ranAt ?? undefined };
        }
        return card;
      })
    }))
  }));
  return { frames, errors: data.errors ?? [], results };
};

// One frame for POST /api/v2/frames: the server numbers steps/cards by position, validates
// var-names and the frontmatter, and stores inherited script bodies empty.
export const frameToApi = (name: string, steps: Step[]): FrameData => ({
  name,
  steps: steps.map((step, idx) => ({
    number: idx + 1,
    cards: step.cards.map((card) => ({
      varName: cardVarName(card),
      title: card.title,
      type: card.type,
      sourceType: card.sourceType,
      sourceName: card.sourceName,
      script: card.script ?? null,
      endpoint: card.endpoint,
      httpMethod: card.httpMethod,
      timeout: card.timeout,
      width: card.width,
      height: card.height,
      resultHeight: card.resultHeight ?? null,
      code: card.code,
      privateData: card.privateData ?? null,
      lastRun: null
    }))
  }))
});

// Code rules per source type are still checked here before a frame save (server-side in Phase 2)
export const frameCodeProblems = (steps: Step[]): string[] =>
  steps.flatMap((step, stepIdx) =>
    step.cards.flatMap((card) => {
      const problem = validateSourceCode(card.sourceType, card.code);
      return problem ? [`step ${stepIdx + 1} "${card.title}": ${problem}`] : [];
    })
  );

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
