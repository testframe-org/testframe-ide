// A mongo card's code on the wire is one JSON object keyed by its body sections
// ({ "filter": ..., "projection": ... } or { "aggregation": [...] }); on disk the server writes
// each section as a label line + its own ```json block. These helpers split and rebuild that
// object while keeping each value's text as written ({{bindings}} included, so no JSON.parse).
// Mirror of the server's format/MongoSections (split + the canonical wire form).

/** Top-level keys of the code object with their raw value text, or null when it is not one. */
export function splitSections(code: string): Record<string, string> | null {
  const text = code.trim();
  if (!text) return {};
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const out: Record<string, string> = {};
  const end = text.length - 1;
  let i = skip(text, 1, end);
  while (i < end) {
    if (text[i] !== '"') return null;
    const keyEnd = stringEnd(text, i, end);
    if (keyEnd < 0) return null;
    const key = text.slice(i + 1, keyEnd);
    i = skip(text, keyEnd + 1, end);
    if (i >= end || text[i] !== ':') return null;
    const valueEnd = valueEndAt(text, i + 1, end);
    if (valueEnd < 0) return null;
    const value = text.slice(i + 1, valueEnd).trim();
    if (!value || key in out) return null;
    out[key] = value;
    i = skip(text, valueEnd + 1, end);
  }
  return out;
}

/** The canonical wire code of sections (in the given order; empty values are left out). */
export function joinSections(sections: [string, string][]): string {
  const entries = sections.filter(([, v]) => v.trim()).map(([k, v]) => `  "${k}": ${v.trim()}`);
  return entries.length ? `{\n${entries.join(',\n')}\n}` : '';
}

const skip = (text: string, i: number, end: number): number => {
  while (i < end && /\s/.test(text[i])) i++;
  return i;
};

const stringEnd = (text: string, start: number, end: number): number => {
  for (let i = start + 1; i < end; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i;
  }
  return -1;
};

const valueEndAt = (text: string, start: number, end: number): number => {
  let depth = 0;
  let j = start;
  while (j < end) {
    const ch = text[j];
    if (ch === '"') {
      j = stringEnd(text, j, end);
      if (j < 0) return -1;
    } else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) break;
    j++;
  }
  return depth === 0 ? j : -1;
};
