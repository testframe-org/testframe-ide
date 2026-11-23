import * as JsonassertCode from './jsonassert-code';
import * as MongoCall from './mongo-call';
import * as MongoJson from './mongo-json';

// Code rules per (source type, subtype) (agents/specs/project-format.md, "Code rules"). The editor asks
// the IDE (POST /api/v2/validate), the frame save enforces them, and the runner checks them again
// before a card runs. Empty code is a draft and always acceptable; kinds without a rule accept
// anything.

const SQL_STATEMENT = /^select\b/i;
const SQL_STRING = /'(?:''|[^'])*'/g;

const orNull = (s: string | null | undefined) => (s ? s : null);

/** The problem with `code` for a card of (sourceType, subtype), or null when acceptable. */
export function problem(sourceType: string | null | undefined, subtype: string | null | undefined, code: string | null | undefined): string | null {
  const text = code ?? '';
  const sub = subtype ?? '';
  switch (sourceType ?? '') {
    case 'mongo':
      return MongoCall.problem(orNull(sub), text);
    case 'sql':
      return sub === 'oracle' ? sqlProblem(stripLineComments(text, '--')) : null;
    case 'jsonassert':
      return JsonassertCode.problem(sub, text);
    default:
      return null;
  }
}

/** Every problem of the code (mongo: one per argument, e.g. `arg 3 (options): unknown key "foo"`). */
export function problems(sourceType: string | null | undefined, subtype: string | null | undefined, code: string | null | undefined): string[] {
  if (sourceType === 'mongo') return MongoCall.problems(orNull(subtype), code);
  const p = problem(sourceType, subtype, code);
  return p === null ? [] : [p];
}

/** The canonical text the save stores (mongo arrays), or null when there is none. */
export const formatted = (sourceType: string | null | undefined, code: string | null | undefined): string | null =>
  sourceType === 'mongo' ? MongoJson.format(code) : null;

function sqlProblem(body: string): string | null {
  if (!body) return null;
  if (!SQL_STATEMENT.test(body)) return 'oracle cards accept a single SELECT statement';
  const statement = body.replace(/;\s*$/, '');
  if (statement.replace(SQL_STRING, '').includes(';')) return 'only one SELECT statement is allowed';
  return null;
}

function stripLineComments(code: string, marker: string): string {
  return code
    .split('\n')
    .filter((line) => !line.trim().startsWith(marker))
    .join('\n')
    .trim();
}
