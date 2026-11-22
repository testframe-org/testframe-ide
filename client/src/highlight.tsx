import { languageOfKind } from './catalog';
import type { Card } from './client-api/testframe.z';

// --- LIGHTWEIGHT SYNTAX HIGHLIGHTING ---
// Single-pass tokenizer per language: each line is split into tokens by one combined regex,
// text is HTML-escaped once and every token gets a class (no chained replaces over HTML).

export type HighlightLang = 'js' | 'json' | 'sql' | 'jsonassert' | 'text';

type Rule = [cls: string, pattern: string];

const STRING = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|` + '`(?:\\\\.|[^`\\\\])*`';
const NUMBER = String.raw`\b\d+(?:\.\d+)?\b`;

const RULES: Record<Exclude<HighlightLang, 'text'>, Rule[]> = {
  js: [
    ['text-slate-500 italic', String.raw`\/\/.*$`],
    ['text-amber-300', STRING],
    ['text-purple-400 font-semibold', String.raw`\b(?:const|let|var|await|async|return|function|if|else|new|of|in)\b`],
    ['text-purple-400', String.raw`\b(?:true|false|null|undefined)\b`],
    ['text-rose-300', String.raw`\bdb\b`],
    ['text-pink-300', String.raw`\$[A-Za-z_]\w*`],
    ['text-sky-300', String.raw`\b[A-Za-z_]\w*(?=\s*:)`],
    ['text-yellow-200', String.raw`\b[A-Za-z_]\w*(?=\s*\()`],
    ['text-emerald-300', NUMBER]
  ],
  json: [
    ['text-sky-300', String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`],
    ['text-amber-300', String.raw`"(?:\\.|[^"\\])*"`],
    ['text-purple-400 font-semibold', String.raw`\b(?:true|false|null)\b`],
    ['text-emerald-300', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
    ['text-pink-300', String.raw`\{\{[^}]*\}\}`]
  ],
  sql: [
    ['text-slate-500 italic', String.raw`--.*$`],
    ['text-amber-300', String.raw`'(?:''|[^'])*'`],
    [
      'text-purple-400 font-semibold',
      String.raw`\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|INNER|LEFT|RIGHT|OUTER|FULL|JOIN|ON|AS|ORDER|GROUP|BY|HAVING|LIMIT|OFFSET|FETCH|FIRST|ROWS|ONLY|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|WITH|ASC|DESC)\b`
    ],
    ['text-yellow-200', String.raw`\b[A-Za-z_]\w*(?=\s*\()`],
    ['text-emerald-300', NUMBER]
  ],
  jsonassert: [
    ['text-slate-500 italic', String.raw`\/\/.*$`],
    ['text-amber-300', STRING],
    ['text-purple-400 font-semibold', String.raw`\b(?:assert|and|or|not|if|else|switch|case|default|for|in|while|function)\b`],
    ['text-purple-400', String.raw`\b(?:true|false|null)\b`],
    ['text-yellow-200', String.raw`\$[A-Za-z_]\w*(?=\s*\()`],
    ['text-pink-300', String.raw`\$[A-Za-z_]\w*|\$`],
    ['text-rose-300', String.raw`==|!=|>=|<=|>|<`],
    ['text-emerald-300', NUMBER]
  ]
};

const COMPILED = Object.fromEntries(
  Object.entries(RULES).map(([lang, rules]) => [
    lang,
    {
      classes: rules.map(([cls]) => cls),
      regex: new RegExp(rules.map(([, pattern]) => `(${pattern})`).join('|'), lang === 'sql' ? 'gi' : 'g')
    }
  ])
) as Record<Exclude<HighlightLang, 'text'>, { classes: string[]; regex: RegExp }>;

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const colorLine = (line: string, lang: HighlightLang): string => {
  if (lang === 'text') return escapeHtml(line);
  const { classes, regex } = COMPILED[lang];
  regex.lastIndex = 0;
  let html = '';
  let last = 0;
  for (let m = regex.exec(line); m; m = regex.exec(line)) {
    if (m[0] === '') {
      regex.lastIndex++;
      continue;
    }
    const group = m.slice(1).findIndex((g) => g !== undefined);
    html += escapeHtml(line.slice(last, m.index));
    html += `<span class="${classes[group]}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(line.slice(last));
};

// Language of a card's code: the fence language of its (type-source, subtype), served by the catalog
export const languageOf = (card: Pick<Card, 'sourceType' | 'subtype'>): HighlightLang => {
  const lang = languageOfKind(card.sourceType, card.subtype);
  return lang === 'js' || lang === 'json' || lang === 'sql' || lang === 'jsonassert' ? lang : 'text';
};

export const highlightSyntax = (code: string, lang: HighlightLang) =>
  code.split('\n').map((line, idx) => (
    <div key={idx} className="flex leading-5 min-h-[20px]">
      <span className="w-7 shrink-0 select-none text-right pr-2.5 text-[11px] text-slate-500 font-mono">{idx + 1}</span>
      <span
        className="font-mono text-[12px] text-slate-200 whitespace-pre"
        dangerouslySetInnerHTML={{ __html: colorLine(line, lang) || ' ' }}
      />
    </div>
  ));
