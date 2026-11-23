// Code completion for the card editors (pure logic, no DOM).
//
// Two modes:
// - 'bindings' (request bodies, mongo/sql bodies, rawvalue json, code): only `{{varName.path}}`.
// - 'jsonassert' (jsonassert script and conditional cards): bindings plus the jsonassert
//   language: built-in functions (`$sum(`), keywords, var-names and the fields of their values.
//   In jsonassert '$' only prefixes built-in functions; variables are plain names.
//
// Variable samples come from the last run (or each card's stored result) so field paths can be
// suggested; a variable that never ran still completes by name.

export type CompletionMode = 'bindings' | 'jsonassert';
export type CompletionKind = 'variable' | 'field' | 'function' | 'keyword';

export interface CompletionItem {
  /** Shown in the list. */
  label: string;
  /** Replaces the [from, to) range. */
  insert: string;
  kind: CompletionKind;
  /** Short type/preview hint. */
  detail?: string;
  /** Caret position inside `insert` after accepting (default: the end). */
  caretOffset?: number;
}

export interface CompletionResult {
  from: number;
  to: number;
  items: CompletionItem[];
}

export interface CompletionContext {
  mode: CompletionMode;
  /** Variables visible to the card (published by earlier cards), keyed by var-name. */
  vars: Record<string, unknown>;
}

/** Built-in functions of the jsonassert engines (modules/jsonassert, keep in sync). */
export const JSONASSERT_FUNCTIONS: readonly { name: string; signature: string }[] = [
  { name: 'sum', signature: '$sum(array)' },
  { name: 'count', signature: '$count(array)' },
  { name: 'avg', signature: '$avg(array)' },
  { name: 'min', signature: '$min(array)' },
  { name: 'max', signature: '$max(array)' },
  { name: 'length', signature: '$length(string)' },
  { name: 'number', signature: '$number(value)' },
  { name: 'map', signature: '$map(array, function(v) { … })' },
  { name: 'filter', signature: '$filter(array, function(v) { … })' },
  { name: 'each', signature: '$each(object, function(v, k) { … })' },
  { name: 'reduce', signature: '$reduce(array, function(acc, v) { … }, init)' }
];

export const JSONASSERT_KEYWORDS: readonly string[] = [
  'assert', 'and', 'or', 'not', 'true', 'false', 'null',
  'if', 'else', 'switch', 'case', 'default', 'for', 'in', 'while', 'function'
];

const MAX_ITEMS = 50;

/** Short preview of a value's type for the list's right column. */
export function describeValue(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return value.length > 18 ? `"${value.slice(0, 16)}…"` : `"${value}"`;
  return String(value);
}

/**
 * Value at a dotted path, mapping over arrays like JSONata does (`items.price` on an array of
 * items yields every price). Undefined when the path does not exist.
 */
export function valueAtPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const step of path) {
    current = stepInto(current, step);
    if (current === undefined) return undefined;
  }
  return current;
}

function stepInto(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => stepInto(item, key)).filter((v) => v !== undefined);
    if (mapped.length === 0) return undefined;
    return mapped.flatMap((v) => (Array.isArray(v) ? v : [v]));
  }
  if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Field names reachable one step below a value (union over array items). */
export function fieldsOf(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.slice(0, 50).forEach(visit);
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (!(k in out)) out[k] = child;
      }
    }
  };
  visit(value);
  return out;
}

const rank = (label: string, prefix: string): number => {
  if (!prefix) return 1;
  const l = label.toLowerCase();
  const p = prefix.toLowerCase();
  if (label.startsWith(prefix)) return 3;
  if (l.startsWith(p)) return 2;
  return l.includes(p) ? 1 : 0;
};

function filterItems(items: CompletionItem[], prefix: string): CompletionItem[] {
  return items
    .map((item, index) => ({ item, index, score: rank(item.label, prefix) }))
    .filter((x) => x.score > 0 && !(x.item.label === prefix && x.item.insert === prefix))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_ITEMS)
    .map((x) => x.item);
}

/** Completions for `path.` segments: var-names at the head, fields after a dot. */
function pathItems(path: string[], vars: Record<string, unknown>): CompletionItem[] {
  if (path.length === 0) {
    return Object.entries(vars).map(([name, value]) => ({
      label: name, insert: name, kind: 'variable' as const, detail: describeValue(value)
    }));
  }
  const [head, ...rest] = path;
  if (!(head in vars)) return [];
  return Object.entries(fieldsOf(valueAtPath(vars[head], rest))).map(([name, child]) => ({
    label: name,
    insert: /^[A-Za-z_][\w]*$/.test(name) ? name : `\`${name}\``,
    kind: 'field' as const,
    detail: describeValue(child)
  }));
}

/** True when the caret sits inside a quoted string literal of the current line. */
function insideString(lineBefore: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < lineBefore.length; i++) {
    const c = lineBefore[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    }
  }
  return quote !== null;
}

/** Length of the identifier characters right after the caret (replaced on accept). */
function identifierTail(text: string, caret: number): number {
  const match = /^[\w]*/.exec(text.slice(caret));
  return match ? match[0].length : 0;
}

/**
 * Suggestions at `caret`, or null when nothing applies (the popup closes).
 * `explicit` (Ctrl+Space) also lists suggestions for an empty prefix.
 */
export function complete(text: string, caret: number, ctx: CompletionContext, explicit = false): CompletionResult | null {
  const before = text.slice(0, caret);

  // {{varName.path}} bindings: every mode
  const binding = /\{\{\s*([A-Za-z_][\w]*(?:\.[\w]*)*|)$/.exec(before);
  if (binding) {
    const segments = (binding[1] ?? '').split('.');
    const prefix = segments.pop() ?? '';
    const from = caret - prefix.length;
    const closes = text.slice(caret).trimStart().startsWith('}}');
    const filtered = filterItems(pathItems(segments.filter(Boolean), ctx.vars), prefix);
    if (!filtered.length) return null;
    // close the binding when accepting a name if nothing closes it yet
    const withClose = closes
      ? filtered
      : filtered.map((item) => ({ ...item, insert: `${item.insert}}}`, caretOffset: item.insert.length }));
    return { from, to: caret + identifierTail(text, caret), items: withClose };
  }

  if (ctx.mode !== 'jsonassert') return null;

  const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
  if (insideString(lineBefore) || /^\s*\/\//.test(lineBefore)) return null;

  // $func(: built-in functions only
  const fn = /\$([A-Za-z_]\w*|)$/.exec(before);
  if (fn) {
    const prefix = fn[1] ?? '';
    const items: CompletionItem[] = JSONASSERT_FUNCTIONS.map((f) => ({
      label: `$${f.name}`,
      insert: `$${f.name}()`,
      caretOffset: f.name.length + 2,
      kind: 'function',
      detail: f.signature
    }));
    const filtered = filterItems(items, `$${prefix}`);
    return filtered.length ? { from: caret - prefix.length - 1, to: caret + identifierTail(text, caret), items: filtered } : null;
  }

  // var.field.sub: fields of a variable's sample value
  const dotted = /(?:^|[^\w.$`])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*|)$/.exec(before);
  if (dotted) {
    const path = (dotted[1] ?? '').split('.');
    const prefix = dotted[2] ?? '';
    const filtered = filterItems(pathItems(path, ctx.vars), prefix);
    return filtered.length ? { from: caret - prefix.length, to: caret + identifierTail(text, caret), items: filtered } : null;
  }

  // bare identifier: var-names, keywords (and function names, inserted with their '$')
  const ident = /(?:^|[^\w.$`])([A-Za-z_]\w*|)$/.exec(before);
  if (!ident) return null;
  const prefix = ident[1] ?? '';
  if (!prefix && !explicit) return null;
  const items: CompletionItem[] = [
    ...pathItems([], ctx.vars),
    ...JSONASSERT_KEYWORDS.map((k) => ({ label: k, insert: k, kind: 'keyword' as const })),
    ...JSONASSERT_FUNCTIONS.map((f) => ({
      label: `$${f.name}`, insert: `$${f.name}()`, caretOffset: f.name.length + 2, kind: 'function' as const, detail: f.signature
    }))
  ];
  // match functions by name without the '$' too (typing `su` offers `$sum`)
  const filtered = filterItems(
    items.map((item) => (item.kind === 'function' ? { ...item, label: item.label.slice(1) } : item)),
    prefix
  ).map((item) => (item.kind === 'function' ? { ...item, label: `$${item.label}` } : item));
  return filtered.length ? { from: caret - prefix.length, to: caret + identifierTail(text, caret), items: filtered } : null;
}
