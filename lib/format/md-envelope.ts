// The envelope shared by every project .md file (agents/specs/project-format.md):
//
//   -------------------
//   key: value
//   -------------------
//   body
//
// Code bodies are fenced Markdown blocks with a language (fence/unfence); private notes and
// flow.md are plain text.

export const FRAME_SEP = '-------------------';

const FIELD = /^([A-Za-z0-9_-]+):\s?(.*)$/;
const FENCE_OPEN = /^(`{3,})[A-Za-z0-9_-]*$/;

export interface ParsedMd {
  /** Frontmatter fields in file order; a repeated key keeps its last value. */
  fields: Map<string, string>;
  body: string;
}

export const stripTrailingNewlines = (text: string): string => text.replace(/\n+$/, '');

/**
 * Frontmatter = the lines between the first two separator lines; the body is everything after
 * the closing one, without trailing newlines.
 */
export function parse(md: string | null | undefined): ParsedMd {
  const lines = (md ?? '').split(/\r?\n/);
  const fields = new Map<string, string>();
  let i = 0;
  if (lines.length > 0 && lines[0] === FRAME_SEP) {
    i = 1;
    while (i < lines.length && lines[i] !== FRAME_SEP) {
      const m = FIELD.exec(lines[i]!);
      if (m) fields.set(m[1]!, m[2]!);
      i++;
    }
    i++; // closing separator
  }
  const body = i < lines.length ? lines.slice(i).join('\n') : '';
  return { fields, body: stripTrailingNewlines(body) };
}

export type FieldList = Iterable<readonly [string, unknown]>;

/**
 * Renders fields in order, omitting null/undefined and empty values. A non-empty body (trailing
 * newlines removed) ends with exactly one newline.
 */
export function render(fields: FieldList, body?: string | null): string {
  let out = `${FRAME_SEP}\n`;
  for (const [key, value] of fields) {
    if (value !== null && value !== undefined && String(value) !== '') out += `${key}: ${String(value)}\n`;
  }
  out += `${FRAME_SEP}\n`;
  const text = stripTrailingNewlines(body ?? '');
  if (text) out += `${text}\n`;
  return out;
}

/** An envelope with an empty frontmatter (private notes, flow.md). */
export const renderBody = (body?: string | null): string => render([], body);

const isBlank = (text: string) => text.trim() === '';

/**
 * Wraps code in a fenced block tagged with `lang` (empty code stays empty). The fence is longer
 * than any backtick run inside the code, so it never closes early.
 */
export function fence(lang: string, code?: string | null): string {
  const text = stripTrailingNewlines(code ?? '');
  if (isBlank(text)) return '';
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const marks = '`'.repeat(Math.max(3, longest + 1));
  return `${marks}${lang}\n${text}\n${marks}`;
}

/** The code inside a fenced block (a body without a fence is returned as is). */
export function unfence(body?: string | null): string {
  const text = stripTrailingNewlines(body ?? '');
  const firstBreak = text.indexOf('\n');
  if (firstBreak < 0) return text;
  const open = FENCE_OPEN.exec(text.slice(0, firstBreak));
  if (!open || !text.endsWith(`\n${open[1]}`)) return text;
  const end = text.length - open[1]!.length - 1;
  return end <= firstBreak ? '' : text.slice(firstBreak + 1, end);
}
