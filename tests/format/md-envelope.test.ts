import { describe, expect, test } from 'bun:test';
import { FRAME_SEP, fence, parse, render, renderBody, stripTrailingNewlines, unfence } from '@/lib/format/md-envelope';

// Port of server/src/test/java/com/testframe/server/format/MdEnvelopeTest.java

describe('md envelope', () => {
  test('renders fields in order, omitting null and empty values', () => {
    const fields: [string, unknown][] = [
      ['title', 'Get data'],
      ['order', 1],
      ['source', null],
      ['endpoint', ''],
      ['timeout', 5000]
    ];
    expect(render(fields, fence('js', 'db.x.find()\n\n\n'))).toBe(
      `-------------------
title: Get data
order: 1
timeout: 5000
-------------------
\`\`\`js
db.x.find()
\`\`\`
`
    );
  });

  test('an empty body ends right after the closing separator', () => {
    const bare = `${FRAME_SEP}\n${FRAME_SEP}\n`;
    expect(renderBody('')).toBe(bare);
    expect(renderBody('\n\n')).toBe(bare);
    expect(render([], null)).toBe(bare);
    expect(fence('js', '  \n')).toBe('');
  });

  test('parses fields and body', () => {
    const md = parse(`-------------------
title: Get data
base-url: mongodb://localhost:27017/x
empty:
not a field
-------------------
line 1

line 3


`);
    expect([...md.fields]).toEqual([
      ['title', 'Get data'],
      ['base-url', 'mongodb://localhost:27017/x'],
      ['empty', '']
    ]);
    expect(md.body).toBe('line 1\n\nline 3');
  });

  test('handles CRLF and keeps leading blank lines', () => {
    const md = parse('-------------------\r\ntitle: A\r\n-------------------\r\n\r\nbody\n');
    expect(md.fields.get('title')).toBe('A');
    expect(md.body).toBe('\nbody');
  });

  test('without frontmatter everything is body', () => {
    const md = parse('title: A\nfree text');
    expect(md.fields.size).toBe(0);
    expect(md.body).toBe('title: A\nfree text');
    expect(parse(null).body).toBe('');
    expect(parse(undefined).body).toBe('');
  });

  test('a repeated key keeps its last value', () => {
    expect(parse('-------------------\na: 1\na: 2\n-------------------\n').fields.get('a')).toBe('2');
  });

  test('fences round trip and outgrow backticks in the code', () => {
    const code = 'assert $count(activeProducts) > 0';
    expect(fence('jsonassert', code)).toBe(`\`\`\`jsonassert\n${code}\n\`\`\``);
    expect(unfence(fence('jsonassert', code))).toBe(code);

    const withTicks = 'const md = ```x```;';
    const fenced = fence('js', withTicks);
    expect(fenced).toBe(`\`\`\`\`js\n${withTicks}\n\`\`\`\``);
    expect(unfence(fenced)).toBe(withTicks);

    expect(unfence('plain text')).toBe('plain text');
    expect(unfence('```json\n```')).toBe('');
    expect(unfence(null)).toBe('');
  });

  test('render then parse round trips', () => {
    const fields: [string, unknown][] = [
      ['status', 'success'],
      ['summary', 'ok: 2 docs']
    ];
    const md = render(fields, fence('json', '[1, 2]'));
    const parsed = parse(md);
    expect([...parsed.fields]).toEqual([
      ['status', 'success'],
      ['summary', 'ok: 2 docs']
    ]);
    expect(unfence(parsed.body)).toBe('[1, 2]');
    expect(render([...parsed.fields], parsed.body)).toBe(md);
  });

  test('a field value keeps its spaces and colons', () => {
    expect(parse('-------------------\nendpoint: POST /api/products\n-------------------\n').fields.get('endpoint')).toBe(
      'POST /api/products'
    );
  });

  test('stripTrailingNewlines only cuts the end', () => {
    expect(stripTrailingNewlines('\n\na\n\n\n')).toBe('\n\na');
    expect(stripTrailingNewlines('')).toBe('');
  });
});
