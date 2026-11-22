import { describe, expect, test } from 'bun:test';
import { format } from '@/lib/format/mongo-json';

// Port of server/src/test/java/com/testframe/server/format/MongoJsonTest.java

describe('mongo canonical body text', () => {
  test('formats the user paste canonically', () => {
    // trailing spaces, irregular indentation, blank lines: the user may type it any way
    const paste =
      '[   \n      {"ativo" :true ,  "categoria":   "Ferramentas"}   ,\n\n' +
      '  { "nome": 1,\n        "preco":1 }  ,   {"sort":{"preco":-1},"limit":  5}\n   ]   \n';
    const canonical = `[\n  { "ativo": true, "categoria": "Ferramentas" },\n  { "nome": 1, "preco": 1 },\n  { "sort": { "preco": -1 }, "limit": 5 }\n]`;
    expect(format(paste)).toBe(canonical);
    expect(format(canonical)).toBe(canonical);
  });

  test('keeps bindings, strings and numbers verbatim', () => {
    expect(
      format(
        '[{"nome":"{{first.nome}}","preco":{{max}},"s":"a,b: {c}","n":1.50e2},' +
          '[{"$match":{}},{"$limit":{{n}}}]]'
      )
    ).toBe(
      `[\n  { "nome": "{{first.nome}}", "preco": {{max}}, "s": "a,b: {c}", "n": 1.50e2 },\n  [{ "$match": {} }, { "$limit": {{n}} }]\n]`
    );
    expect(format(' [ ] ')).toBe('[]');
    expect(format('  ')).toBe('');
    expect(format('')).toBe('');
    expect(format(null)).toBe('');
  });

  test('key order and nesting survive', () => {
    expect(format('[{"b":1,"a":{"z":[1,{"y":2}]}}]')).toBe('[\n  { "b": 1, "a": { "z": [1, { "y": 2 }] } }\n]');
    expect(format('[{}]')).toBe('[\n  {}\n]');
    expect(format('[[], {}]')).toBe('[\n  [],\n  {}\n]');
  });

  test('escaped strings are kept as written', () => {
    expect(format('["a\\"b", "c\\\\d"]')).toBe('[\n  "a\\"b",\n  "c\\\\d"\n]');
  });

  test('malformed or non-array bodies do not format', () => {
    expect(format('{ "filter": {} }')).toBeNull();
    expect(format('[{ "a": 1 }')).toBeNull();
    expect(format('[{ "a" 1 }]')).toBeNull();
    expect(format('[1] extra')).toBeNull();
    expect(format('[{"a": }]')).toBeNull();
    expect(format('db.products.find({})')).toBeNull();
  });
});
