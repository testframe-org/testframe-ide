import { parseAssert } from '@jsonassert/jsonassert-js';

// The body of a jsonassert card, by subtype (docs/project-format.md, "jsonassert cards"):
//   script:      one statement per line: `assert <expr> <op> <expr>` lines and/or plain
//                expressions (the value of the last plain expression is the card's variable);
//   conditional: exactly one boolean expression (no `assert`).
// `//` lines are comments. Parsing goes through the jsonassert engine (jsonassert-js).

export const SCRIPT = 'script';
export const CONDITIONAL = 'conditional';

const ASSERT_HEAD = /^assert\b/;

/** The statements of a body: trimmed lines without blanks and `//` comments. */
export function statements(code: string | null | undefined): string[] {
  return (code ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));
}

export const isAssert = (statement: string): boolean => ASSERT_HEAD.test(statement);

/** The code rule of a jsonassert body for `subtype`, or null when acceptable (empty = draft). */
export function problem(subtype: string | null | undefined, code: string | null | undefined): string | null {
  const list = statements(code);
  if (list.length === 0) return null;
  if (subtype === CONDITIONAL) {
    if (list.length !== 1) return 'a conditional holds exactly one boolean expression';
    const expression = list[0]!;
    if (isAssert(expression)) return `a conditional is a bare boolean expression (no assert): ${expression}`;
    return parseProblem(expression, false);
  }
  if (subtype === SCRIPT) {
    for (const statement of list) {
      const p = parseProblem(statement, isAssert(statement));
      if (p !== null) return p;
    }
  }
  return null;
}

function parseProblem(statement: string, assertLine: boolean): string | null {
  try {
    if (assertLine) parseAssert(statement);
    else parseExpression(statement);
    return null;
  } catch (e) {
    return `not a jsonassert ${assertLine ? 'assert line' : 'expression'}: ${statement} (${(e as Error).message})`;
  }
}

/**
 * Parses one plain jsonassert expression. jsonassert-js exports no expression parser of its own,
 * so the expression is parsed as the left operand of an assert line: `assert (E) == null`. The
 * brackets of E are checked first (outside strings) so that E cannot close the added parentheses
 * and smuggle in a top-level operator.
 */
function parseExpression(expression: string): void {
  const unbalanced = bracketProblem(expression);
  if (unbalanced) throw new Error(unbalanced);
  parseAssert(`assert (${expression}) == null`);
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function bracketProblem(text: string): string | null {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c in PAIRS) {
      if (stack.pop() !== PAIRS[c]) return `unbalanced '${c}' at ${i}`;
    }
  }
  if (quote) return 'unterminated string';
  if (stack.length) return `unclosed '${stack[stack.length - 1]}'`;
  return null;
}
