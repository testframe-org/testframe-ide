// The canonical text of a mongo card body (a JSON array of call arguments, possibly with
// {{bindings}}): one argument per line, each printed compactly ({ "a": 1, "b": [1, 2] }), key
// order and every string, number and binding kept verbatim. The user may type the array any
// way; the IDE stores this form, so a second save of unchanged content is byte-identical.
//
//   [
//     { "ativo": true },
//     { "nome": 1 }
//   ]

type Value = Atom | Arr | Obj;
interface Atom {
  kind: 'atom';
  text: string;
}
interface Arr {
  kind: 'arr';
  items: Value[];
}
interface Obj {
  kind: 'obj';
  keys: string[];
  values: Value[];
}

class SyntaxProblem extends Error {}

/** The canonical text, or null when the code is not a well-formed array (the code rule reports why). */
export function format(code: string | null | undefined): string | null {
  if (!code || code.trim() === '') return '';
  try {
    const r = new Reader(code);
    const value = r.value();
    r.skip();
    if (!r.atEnd() || value.kind !== 'arr') return null;
    if (value.items.length === 0) return '[]';
    return `[\n${value.items.map((item) => `  ${print(item)}`).join(',\n')}\n]`;
  } catch (e) {
    if (e instanceof SyntaxProblem) return null;
    throw e;
  }
}

function print(value: Value): string {
  if (value.kind === 'atom') return value.text;
  if (value.kind === 'arr') return `[${value.items.map(print).join(', ')}]`;
  if (value.keys.length === 0) return '{}';
  return `{ ${value.keys.map((k, i) => `${k}: ${print(value.values[i]!)}`).join(', ')} }`;
}

const WHITESPACE = /\s/;
const DELIMITERS = '{}[],: \t\r\n';

class Reader {
  private pos = 0;

  constructor(private readonly text: string) {}

  atEnd(): boolean {
    return this.pos >= this.text.length;
  }

  skip(): void {
    while (!this.atEnd() && WHITESPACE.test(this.text[this.pos]!)) this.pos++;
  }

  private peek(): string {
    return this.text[this.pos]!;
  }

  value(): Value {
    this.skip();
    if (this.atEnd()) throw new SyntaxProblem('unexpected end');
    const ch = this.peek();
    if (this.text.startsWith('{{', this.pos)) {
      const end = this.text.indexOf('}}', this.pos);
      if (end < 0) throw new SyntaxProblem('unclosed binding');
      const binding = this.text.slice(this.pos, end + 2);
      this.pos = end + 2;
      return { kind: 'atom', text: binding };
    }
    if (ch === '{') {
      this.pos++;
      const keys: string[] = [];
      const values: Value[] = [];
      this.skip();
      if (!this.atEnd() && this.peek() === '}') {
        this.pos++;
        return { kind: 'obj', keys, values };
      }
      for (;;) {
        this.skip();
        if (this.atEnd() || this.peek() !== '"') throw new SyntaxProblem('expected a key');
        keys.push(this.string());
        this.skip();
        this.expect(':');
        values.push(this.value());
        this.skip();
        if (!this.atEnd() && this.peek() === ',') {
          this.pos++;
          continue;
        }
        this.expect('}');
        return { kind: 'obj', keys, values };
      }
    }
    if (ch === '[') {
      this.pos++;
      const items: Value[] = [];
      this.skip();
      if (!this.atEnd() && this.peek() === ']') {
        this.pos++;
        return { kind: 'arr', items };
      }
      for (;;) {
        items.push(this.value());
        this.skip();
        if (!this.atEnd() && this.peek() === ',') {
          this.pos++;
          continue;
        }
        this.expect(']');
        return { kind: 'arr', items };
      }
    }
    if (ch === '"') return { kind: 'atom', text: this.string() };
    const start = this.pos;
    while (!this.atEnd() && !DELIMITERS.includes(this.peek())) this.pos++;
    if (start === this.pos) throw new SyntaxProblem(`unexpected '${ch}'`);
    return { kind: 'atom', text: this.text.slice(start, this.pos) };
  }

  /** A quoted string, returned with its quotes exactly as written. */
  private string(): string {
    const start = this.pos;
    this.pos++;
    while (!this.atEnd()) {
      const ch = this.peek();
      if (ch === '\\') {
        this.pos += 2;
        continue;
      }
      if (ch === '\n') throw new SyntaxProblem('line break inside a string');
      this.pos++;
      if (ch === '"') return this.text.slice(start, this.pos);
    }
    throw new SyntaxProblem('unterminated string');
  }

  private expect(ch: string): void {
    this.skip();
    if (this.atEnd() || this.peek() !== ch) throw new SyntaxProblem(`expected '${ch}'`);
    this.pos++;
  }
}
