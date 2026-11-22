// Strict JSON check: what JSON.parse accepts, plus no duplicate keys inside one object
// (a repeated key would silently drop a filter or option).

/** The problem with `text` as strict JSON, or null when it is well formed. */
export function strictJsonProblem(text: string): string | null {
  try {
    JSON.parse(text);
  } catch (e) {
    return (e as Error).message;
  }
  const duplicate = new DuplicateScanner(text).scan();
  return duplicate === null ? null : `duplicate field ${JSON.stringify(duplicate)}`;
}

/** Walks text that JSON.parse already accepted and returns the first duplicated key, or null. */
class DuplicateScanner {
  private pos = 0;

  constructor(private readonly text: string) {}

  scan(): string | null {
    return this.value();
  }

  private ws(): void {
    while (this.pos < this.text.length && ' \t\r\n'.includes(this.text[this.pos]!)) this.pos++;
  }

  private value(): string | null {
    this.ws();
    const ch = this.text[this.pos];
    if (ch === '{') {
      this.pos++;
      const seen = new Set<string>();
      this.ws();
      if (this.text[this.pos] === '}') {
        this.pos++;
        return null;
      }
      for (;;) {
        this.ws();
        const key = JSON.parse(this.rawString()) as string;
        if (seen.has(key)) return key;
        seen.add(key);
        this.ws();
        this.pos++; // ':'
        const nested = this.value();
        if (nested !== null) return nested;
        this.ws();
        if (this.text[this.pos] === ',') {
          this.pos++;
          continue;
        }
        this.pos++; // '}'
        return null;
      }
    }
    if (ch === '[') {
      this.pos++;
      this.ws();
      if (this.text[this.pos] === ']') {
        this.pos++;
        return null;
      }
      for (;;) {
        const nested = this.value();
        if (nested !== null) return nested;
        this.ws();
        if (this.text[this.pos] === ',') {
          this.pos++;
          continue;
        }
        this.pos++; // ']'
        return null;
      }
    }
    if (ch === '"') {
      this.rawString();
      return null;
    }
    while (this.pos < this.text.length && !',]} \t\r\n'.includes(this.text[this.pos]!)) this.pos++;
    return null;
  }

  private rawString(): string {
    const start = this.pos;
    this.pos++;
    while (this.text[this.pos] !== '"') {
      if (this.text[this.pos] === '\\') this.pos++;
      this.pos++;
    }
    this.pos++;
    return this.text.slice(start, this.pos);
  }
}
