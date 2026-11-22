import * as Catalog from './catalog';
import * as MdEnvelope from './md-envelope';
import * as MongoCall from './mongo-call';
import * as MongoJson from './mongo-json';
import * as Names from './names';
import type { Card } from './types';

// One card file (frames/{frame}/step-{n}/{var-file}.md) and its private sibling
// {var-file}.private.md. The frontmatter stores only what the path cannot express
// (docs/project-format.md, "Cards").

export const CARD_SUFFIX = '.md';
export const PRIVATE_SUFFIX = '.private.md';

const SOURCE_REF = /^([a-z]+)(?:\/([a-z0-9][a-z0-9_-]*))?$/;
const SIZE = /^\d+x\d+$/;
const OPERATION_ID = /^[A-Za-z0-9_.-]+$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ENDPOINT = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i;

/** A parsed card: non-empty `errors` means the file is invalid and `card` is null. */
export interface Parsed {
  card: Card | null;
  errors: string[];
  warnings: string[];
}

const sourceTypeOf = (card: Card) => Names.trim(card.sourceType);

/**
 * Renders a card; its code always lives in the card itself. The card's position in the step is
 * not stored here: it comes from the step's flow.md.
 */
export function render(card: Card): string {
  const subtype = Names.trim(card.subtype);
  const type = Catalog.cardTypeOf(sourceTypeOf(card), subtype);
  const size = Catalog.defaultSize(type);
  const width = card.width ?? size.width;
  const height = card.height ?? size.height;
  const customSize = width !== size.width || height !== size.height;
  const title = Names.trim(card.title);
  const openapiId = Names.trim(card.openapiId);
  const fields: [string, unknown][] = [
    ['title', title || card.varName],
    ['source', sourceRef(card)],
    ['subtype', subtype || null],
    ['collection', card.collection || null],
    ['endpoint', Names.trim(card.endpoint)],
    ['openapi-id', openapiId || null],
    ['timeout', card.timeout ?? Catalog.defaultTimeout(type)],
    ['size', customSize ? `${width}x${height}` : null],
    ['result-height', card.resultHeight]
  ];
  return MdEnvelope.render(fields, body(sourceTypeOf(card), subtype, card.code ?? ''));
}

/** Parses a card file. `fileBase` is the var-file (no extension). */
export function parse(fileBase: string, content: string): Parsed {
  const md = MdEnvelope.parse(content);
  const f = md.fields;
  const errors = validate(f);
  if (errors.length) return { card: null, errors, warnings: [] };
  const ref = f.get('source')!.split('/');
  const sourceType = ref[0]!;
  const sourceName = ref.length > 1 ? ref[1]! : '';
  const subtype = f.get('subtype') ?? null;
  const type = Catalog.cardTypeOf(sourceType, subtype);
  const size = Catalog.defaultSize(type);
  let { width, height } = size;
  if (f.has('size')) {
    const [w, h] = f.get('size')!.split('x');
    width = Number(w);
    height = Number(h);
  }
  const endpoint = f.get('endpoint') ?? '';
  const card: Card = {
    varName: Names.fileNameToVarName(fileBase),
    title: f.get('title')!,
    type,
    sourceType,
    subtype,
    collection: f.get('collection') ?? null,
    sourceName,
    endpoint,
    openapiId: f.get('openapi-id') ?? null,
    httpMethod: httpMethodOf(endpoint),
    timeout: f.has('timeout') ? toInt(f.get('timeout')!) : Catalog.defaultTimeout(type),
    width,
    height,
    resultHeight: f.has('result-height') ? toInt(f.get('result-height')!) : null,
    code: MdEnvelope.unfence(md.body),
    privateData: null,
    lastRun: null
  };
  return { card, errors: [], warnings: [] };
}

type Fields = Map<string, string> | Record<string, string>;

const asMap = (f: Fields): Map<string, string> => (f instanceof Map ? f : new Map(Object.entries(f)));

/** Frontmatter schema of a card file: one `key: problem` per violation. */
export function validate(fields: Fields): string[] {
  const f = asMap(fields);
  const errors: string[] = [];
  if (!f.get('title')) errors.push('title: required');
  const source = f.get('source');
  let sourceType: string | null = null;
  if (!source) {
    errors.push('source: required ({type-source}/{name-source}, or rawvalue)');
  } else if (!SOURCE_REF.test(source)) {
    errors.push('source: source must be {type-source} or {type-source}/{name-source}');
  } else if (!Catalog.SOURCE_TYPES.includes(source.split('/')[0]!)) {
    errors.push('source: unknown type-source');
  } else {
    sourceType = source.split('/')[0]!;
    if (!Catalog.hasSources(sourceType) && source.includes('/')) {
      errors.push(`source: ${sourceType} cards have no name-source (write source: ${sourceType})`);
    }
  }
  if (sourceType !== null) {
    const p = Catalog.subtypeProblem(sourceType, f.get('subtype'));
    if (p) errors.push(`subtype: ${p}`);
  }
  const collection = f.get('collection');
  if (sourceType === 'mongo') {
    const p = MongoCall.collectionProblem(collection);
    if (p) errors.push(`collection: ${p}`);
  } else if (collection !== undefined && sourceType !== null) {
    errors.push('collection: only mongo cards name a collection');
  }
  const openapiId = f.get('openapi-id');
  if (openapiId !== undefined && sourceType !== null && sourceType !== 'openapi') {
    errors.push('openapi-id: only openapi cards name a spec operation');
  } else if (openapiId !== undefined && !OPERATION_ID.test(openapiId)) {
    errors.push("openapi-id: must be the spec's operationId (letters, digits, _ . -)");
  }
  if (f.has('script')) errors.push('script: sources have no scripts; the card holds its own code');
  const timeout = intProblem(f, 'timeout', 100, 120_000);
  if (timeout) errors.push(timeout);
  if (f.has('size') && !SIZE.test(f.get('size')!)) errors.push('size: size must be {width}x{height}');
  const resultHeight = intProblem(f, 'result-height', 24, 600);
  if (resultHeight) errors.push(resultHeight);
  return errors;
}

/**
 * `source:` reference, e.g. mongo/products-db, or the type alone for sourceless types (rawvalue,
 * jsonassert); every card declares one, so a card without a type is rejected on save.
 */
export function sourceRef(card: Card): string | null {
  const type = Names.trim(card.sourceType);
  if (!type) return null;
  if (!Catalog.hasSources(type)) return type;
  const name = Names.trim(card.sourceName);
  return name ? `${type}/${name}` : type;
}

/**
 * The body of a card file: one fenced block in the (type, subtype) language. A mongo card's
 * array of call arguments is stored in its canonical form (mongo-json.ts); a draft that does not
 * format is kept as written (the code rule reports why on save).
 */
function body(sourceType: string, subtype: string, code: string): string {
  const lang = Catalog.languageOf(sourceType, subtype);
  if (sourceType === 'mongo') {
    const formatted = MongoJson.format(code);
    if (formatted !== null) return MdEnvelope.fence(lang, formatted);
  }
  return MdEnvelope.fence(lang, code);
}

/** HTTP method of an endpoint written as `METHOD /path`, or "". */
export function httpMethodOf(endpoint: string | null | undefined): string {
  const m = ENDPOINT.exec(Names.trim(endpoint));
  return m ? m[1]!.toUpperCase() : '';
}

export const renderPrivate = (data: string | null | undefined): string => MdEnvelope.renderBody(data);

export const parsePrivate = (content: string): string => MdEnvelope.parse(content).body;

function intProblem(f: Map<string, string>, key: string, min: number, max: number): string | null {
  if (!f.has(key)) return null;
  const value = toInt(f.get(key)!);
  if (value === null) return `${key}: expected an integer`;
  if (value < min) return `${key}: must be >= ${min}`;
  if (value > max) return `${key}: must be <= ${max}`;
  return null;
}

/** JS Number(text) restricted to 32-bit integers: "" -> 0, "1e3" -> 1000, otherwise null. */
export function toInt(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 ? n : null;
}
