import { EJSON } from 'bson';
import { strictJsonProblem } from './strict-json';

// A mongo card's call (agents/specs/project-format.md, "Mongo cards"): the collection (the card's
// `collection:` frontmatter), the function named by the subtype, and the card body: one JSON
// array whose items are the function's positional arguments, like the shell call
// db.products.find(<arg1>, <arg2>, <arg3>). Trailing optional arguments may be omitted.
//
//   find:                    [filter, projection?, options?]  options: sort, limit, skip, maxTimeMS, collation, hint, comment
//   aggregation:             [pipeline, options?]             options: allowDiskUse, maxTimeMS, batchSize, collation, hint, comment, let
//   deleteOne, deleteMany:   [filter, options?]               options: collation, hint, comment, let
//   updateOne, updateMany:   [filter, update, options?]       options: upsert, arrayFilters, collation, hint, comment, let
//   insertOne:               [document, options?]             options: comment, bypassDocumentValidation
//   insertMany:              [documents, options?]            options: ordered, comment, bypassDocumentValidation
//
// Guards: delete/update need a non-empty filter, an update is $-operators only (or an update
// pipeline), inserted documents are non-empty without top-level $ keys, $out/$merge are rejected
// everywhere, unknown option keys are rejected. Problems name the argument:
// `arg 3 (options): unknown key "foo"`. Values are JSON; MongoDB extended JSON ({"$oid": "..."})
// is understood (the `bson` package's EJSON). The IDE only validates: the plugin runs the call.

export const SUBTYPES = ['find', 'aggregation', 'deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'insertOne', 'insertMany'];
export const WRITE_STAGES = ['$out', '$merge'];

export type OptionKind = 'object' | 'objects' | 'integer' | 'positiveInteger' | 'boolean' | 'string' | 'hint';
export type ArgKind = 'object' | 'array' | 'update' | 'document' | 'documents' | 'options';

/** An option key of the subtype's options argument. */
export interface Option {
  name: string;
  kind: OptionKind;
}

/** One positional argument; `options` lists the keys an options argument accepts. Served by the catalog. */
export interface Arg {
  name: string;
  kind: ArgKind;
  required: boolean;
  options: Option[];
}

const opt = (name: string, kind: OptionKind): Option => ({ name, kind });
const COLLATION = opt('collation', 'object');
const HINT = opt('hint', 'hint');
const COMMENT = opt('comment', 'string');
const LET = opt('let', 'object');
const MAX_TIME = opt('maxTimeMS', 'integer');
const FILTER: Arg = { name: 'filter', kind: 'object', required: true, options: [] };
const options = (...list: Option[]): Arg => ({ name: 'options', kind: 'options', required: false, options: list });

/** The positional arguments of a subtype (empty for an unknown one). */
export function signatureOf(subtype: string | null | undefined): Arg[] {
  switch (subtype ?? '') {
    case 'find':
      return [
        FILTER,
        { name: 'projection', kind: 'object', required: false, options: [] },
        options(opt('sort', 'object'), opt('limit', 'integer'), opt('skip', 'integer'), MAX_TIME, COLLATION, HINT, COMMENT)
      ];
    case 'aggregation':
      return [
        { name: 'pipeline', kind: 'array', required: true, options: [] },
        options(opt('allowDiskUse', 'boolean'), MAX_TIME, opt('batchSize', 'positiveInteger'), COLLATION, HINT, COMMENT, LET)
      ];
    case 'deleteOne':
    case 'deleteMany':
      return [FILTER, options(COLLATION, HINT, COMMENT, LET)];
    case 'updateOne':
    case 'updateMany':
      return [
        FILTER,
        { name: 'update', kind: 'update', required: true, options: [] },
        options(opt('upsert', 'boolean'), opt('arrayFilters', 'objects'), COLLATION, HINT, COMMENT, LET)
      ];
    case 'insertOne':
      return [{ name: 'document', kind: 'document', required: true, options: [] }, options(COMMENT, opt('bypassDocumentValidation', 'boolean'))];
    case 'insertMany':
      return [
        { name: 'documents', kind: 'documents', required: true, options: [] },
        options(opt('ordered', 'boolean'), COMMENT, opt('bypassDocumentValidation', 'boolean'))
      ];
    default:
      return [];
  }
}

export const isWrite = (subtype: string): boolean =>
  ['deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'insertOne', 'insertMany'].includes(subtype);

/** The subtype's call shape, e.g. `find: [filter, projection?, options?]`. */
export function hint(subtype: string, signature: Arg[]): string {
  return `the body is one JSON array of arguments, ${subtype}: [${signature.map((a) => a.name + (a.required ? '' : '?')).join(', ')}]`;
}

const QUOTED_BINDING = /"\{\{[^}]+\}\}"/g;
const BINDING = /\{\{[^}]+\}\}/g;
const COLLATION_KEYS = ['locale', 'caseLevel', 'caseFirst', 'strength', 'numericOrdering', 'alternate', 'maxVariable', 'normalization', 'backwards'];

class ArgProblem extends Error {}

const blank = (s: string | null | undefined) => !s || s.trim() === '';

/**
 * The code rule of a mongo body, or null when acceptable. Empty code is a draft; {{bindings}}
 * stand for any value (they are resolved at run time). Without a subtype there is no rule yet
 * (the card validation reports the missing subtype).
 */
export function problem(subtype: string | null | undefined, code: string | null | undefined): string | null {
  return problems(subtype, code)[0] ?? null;
}

/** Every problem of a mongo body (one per argument at most; empty when acceptable or a draft). */
export function problems(subtype: string | null | undefined, code: string | null | undefined): string[] {
  if (blank(code) || blank(subtype)) return [];
  const probe = code!.replace(QUOTED_BINDING, 'null').replace(BINDING, 'null');
  const issues: string[] = [];
  try {
    check(subtype!, probe, true, issues);
  } catch (e) {
    if (!(e instanceof ArgProblem)) throw e;
    issues.push(e.message);
  }
  return issues;
}

/**
 * Problem of a collection name (the card's `collection:`), or null: non-empty, no `$`, no
 * surrounding spaces, no null character, not a `system.` collection.
 */
export function collectionProblem(collection: string | null | undefined): string | null {
  if (blank(collection)) return 'required on mongo cards (the collection the call works on)';
  const c = collection!;
  if (c !== javaTrim(c) || c.includes('$') || c.includes('\0')) {
    return `"${c}" is not a collection name (no $, no spaces around, no null character)`;
  }
  if (c.startsWith('system.')) return 'system collections cannot be used';
  return null;
}

/** Java String.trim: strips chars <= U+0020. */
const javaTrim = (s: string) => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');

/**
 * Checks the call. `lenient`: null values (bindings in the code rule) are accepted for any
 * argument or option. Argument problems are collected in `issues` (one per argument);
 * structural problems (JSON, shape, arity) throw.
 */
function check(subtype: string, json: string, lenient: boolean, issues: string[]): void {
  const signature = signatureOf(subtype);
  if (signature.length === 0) throw new ArgProblem(`unknown mongo subtype "${subtype}" (${SUBTYPES.join(', ')})`);
  const jsonProblem = strictJsonProblem(json);
  if (jsonProblem !== null) throw new ArgProblem(`invalid JSON: ${jsonProblem}`);
  if (!Array.isArray(JSON.parse(json))) throw new ArgProblem(hint(subtype, signature));
  let args: unknown[];
  try {
    args = EJSON.parse(json, { relaxed: true }) as unknown[];
  } catch (e) {
    throw new ArgProblem(`invalid JSON: ${(e as Error).message}`);
  }
  if (args.length > signature.length) {
    throw new ArgProblem(`${subtype} takes at most ${signature.length} arguments: ${hint(subtype, signature)}`);
  }
  signature.forEach((arg, i) => {
    const label = `arg ${i + 1} (${arg.name}): `;
    try {
      if (i >= args.length) {
        if (arg.required) throw new ArgProblem(`required, ${hint(subtype, signature)}`);
        return;
      }
      const value = args[i];
      const writeStage = writeStageIn(value);
      if (writeStage) throw new ArgProblem(`stage "${writeStage}" is not allowed in mongo cards`);
      // null skips an optional argument (like the shell's find({}, null, {...}))
      if (!(value === null && (lenient || !arg.required))) checkArg(subtype, arg, value, lenient);
    } catch (e) {
      if (!(e instanceof ArgProblem)) throw e;
      issues.push(label + e.message);
    }
  });
}

// ------------------------------------------------------------------ value kinds (EJSON-decoded)

const bsonType = (v: unknown): string | undefined =>
  v !== null && typeof v === 'object' ? (v as { _bsontype?: string })._bsontype : undefined;

/** A JSON object (not an extended-JSON value such as an ObjectId or a date). */
const isDocument = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && bsonType(v) === undefined;

const NUMERIC = ['Long', 'Int32', 'Double', 'Decimal128'];
const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (NUMERIC.includes(bsonType(v) ?? '')) return Number(String(v));
  return null;
};

function checkArg(subtype: string, arg: Arg, value: unknown, lenient: boolean): void {
  switch (arg.kind) {
    case 'object':
      if (!isDocument(value)) throw new ArgProblem('must be an object');
      if (arg.name === 'filter' && isWrite(subtype) && Object.keys(value).length === 0) {
        throw new ArgProblem(
          `${subtype} needs a non-empty filter (an empty filter would ${subtype.startsWith('delete') ? 'delete' : 'update'} the whole collection)`
        );
      }
      return;
    case 'array':
      if (!Array.isArray(value)) throw new ArgProblem('must be an array of stages');
      stages(value, lenient);
      return;
    case 'document':
      insertable(value, '');
      return;
    case 'documents':
      if (!Array.isArray(value) || value.length === 0) throw new ArgProblem('must be an array of at least one document');
      value.forEach((item, i) => {
        if (!(lenient && item === null)) insertable(item, `document ${i + 1} `);
      });
      return;
    case 'update':
      if (Array.isArray(value)) {
        stages(value, lenient);
      } else if (isDocument(value)) {
        const keys = Object.keys(value);
        if (keys.length === 0) throw new ArgProblem('needs at least one $-operator, e.g. {"$set": {...}}');
        for (const key of keys) {
          if (!key.startsWith('$')) {
            throw new ArgProblem(`takes only $-operators ("${key}" would replace the document), e.g. {"$set": {"${key}": ...}}`);
          }
        }
      } else {
        throw new ArgProblem('must be an object of $-operators or an update pipeline (array)');
      }
      return;
    case 'options': {
      if (!isDocument(value)) throw new ArgProblem('must be an object');
      const allowed = arg.options.map((o) => o.name);
      for (const [key, v] of Object.entries(value)) {
        if (!allowed.includes(key)) throw new ArgProblem(`unknown key "${key}" (${subtype} accepts ${allowed.join(', ')})`);
        if (!(lenient && v === null)) checkOption(arg.options[allowed.indexOf(key)]!, v);
      }
      return;
    }
  }
}

function stages(list: unknown[], lenient: boolean): void {
  if (list.length === 0) throw new ArgProblem('needs at least one stage');
  list.forEach((stage, i) => {
    if (!isDocument(stage) && !(lenient && stage === null)) throw new ArgProblem(`stage ${i + 1} must be an object`);
  });
}

/** A document to insert: a non-empty object without top-level `$` keys (operators). */
function insertable(value: unknown, which: string): void {
  if (!isDocument(value) || Object.keys(value).length === 0) throw new ArgProblem(`${which}must be a non-empty object`);
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) throw new ArgProblem(`${which}cannot have the operator key "${key}" (documents hold data)`);
  }
}

function checkOption(option: Option, value: unknown): void {
  const name = option.name;
  switch (option.kind) {
    case 'object':
      if (!isDocument(value)) throw new ArgProblem(`${name} must be an object`);
      if (name === 'collation') collationProblem(value);
      return;
    case 'objects':
      if (!Array.isArray(value) || value.some((v) => !isDocument(v))) throw new ArgProblem(`${name} must be an array of objects`);
      return;
    case 'integer':
    case 'positiveInteger': {
      const min = option.kind === 'integer' ? 0 : 1;
      const n = asNumber(value);
      if (n === null || n < min || n !== Math.round(n) || n > 2147483647) {
        throw new ArgProblem(`${name} must be ${min === 0 ? 'a non-negative' : 'a positive'} integer`);
      }
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new ArgProblem(`${name} must be true or false`);
      return;
    case 'string':
      if (typeof value !== 'string') throw new ArgProblem(`${name} must be a string`);
      return;
    case 'hint':
      if (typeof value !== 'string' && !isDocument(value)) {
        throw new ArgProblem(`${name} must be an index name (string) or an index key object`);
      }
      return;
  }
}

const ONE_OF: Record<string, string[]> = {
  caseFirst: ['upper', 'lower', 'off'],
  alternate: ['non-ignorable', 'shifted'],
  maxVariable: ['punct', 'space']
};
const BOOLEAN_KEYS = ['caseLevel', 'numericOrdering', 'normalization', 'backwards'];

/** Checks a `collation` option like the driver's Collation builder would. */
function collationProblem(doc: Record<string, unknown>): void {
  for (const key of Object.keys(doc)) {
    if (!COLLATION_KEYS.includes(key)) throw new ArgProblem(`unknown collation key "${key}" (${COLLATION_KEYS.join(', ')})`);
  }
  if (typeof doc.locale !== 'string') throw new ArgProblem('collation needs a locale, e.g. {"locale": "pt"}');
  for (const key of BOOLEAN_KEYS) {
    if (key in doc && typeof doc[key] !== 'boolean') throw new ArgProblem(`invalid collation: ${key} must be true or false`);
  }
  for (const [key, values] of Object.entries(ONE_OF)) {
    if (key in doc && !values.includes(doc[key] as string)) {
      throw new ArgProblem(`invalid collation: ${key} must be one of ${values.join(', ')}`);
    }
  }
  if ('strength' in doc) {
    const n = asNumber(doc.strength);
    if (n === null || ![1, 2, 3, 4, 5].includes(n)) throw new ArgProblem('invalid collation: strength must be 1, 2, 3, 4 or 5');
  }
}

/** The first `$out`/`$merge` key found anywhere in the arguments, or null. */
function writeStageIn(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = writeStageIn(item);
      if (nested) return nested;
    }
  } else if (isDocument(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (WRITE_STAGES.includes(key)) return key;
      const nested = writeStageIn(v);
      if (nested) return nested;
    }
  }
  return null;
}
