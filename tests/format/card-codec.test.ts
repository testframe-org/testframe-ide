import { describe, expect, test } from 'bun:test';
import * as CardCodec from '@/lib/format/card-codec';
import * as FrameCodec from '@/lib/format/frame-codec';
import { FormatError } from '@/lib/format/errors';
import type { Card } from '@/lib/format/types';
import { exampleFrames } from '../helpers/example-project';

// Port of server/src/test/java/com/testframe/server/format/CardCodecTest.java

const card = (varName: string, sourceType: string, sourceName: string, code: string): Card => ({
  varName,
  title: `Title of ${varName}`,
  sourceType,
  subtype: sourceType === 'mongo' ? 'find' : sourceType === 'rawvalue' ? 'json' : null,
  collection: sourceType === 'mongo' ? 'products' : null,
  sourceName,
  endpoint: '',
  code
});

describe('card codec', () => {
  test('every committed card file of the example project round trips', () => {
    const cards = exampleFrames().filter((f) => !f.path.endsWith('/flow.md'));
    expect(cards.length).toBeGreaterThan(0);
    for (const file of cards) {
      const fileName = file.path.slice(file.path.lastIndexOf('/') + 1);
      const parsed = CardCodec.parse(fileName.replace('.md', ''), file.content);
      expect(parsed.errors).toEqual([]);
      expect(CardCodec.render(parsed.card!)).toBe(file.content);
    }
  });

  test('defaults come from the card type and size is written only when different', () => {
    expect(CardCodec.render(card('payload', 'rawvalue', '', '{}'))).toBe(
      `-------------------
title: Title of payload
source: rawvalue
subtype: json
timeout: 2000
-------------------
\`\`\`json
{}
\`\`\`
`
    );

    const big: Card = {
      varName: 'sendIt',
      title: ' ',
      sourceType: 'openapi',
      subtype: 'restapi',
      sourceName: 'api',
      endpoint: ' POST /x ',
      timeout: 8000,
      width: 360,
      height: 300,
      resultHeight: 120,
      code: ''
    };
    const md = CardCodec.render(big);
    expect(md).toBe(
      `-------------------
title: sendIt
source: openapi/api
subtype: restapi
endpoint: POST /x
timeout: 8000
size: 360x300
result-height: 120
-------------------
`
    );
    const parsed = CardCodec.parse('send-it', md).card!;
    expect(parsed.type).toBe('request');
    expect(parsed.httpMethod).toBe('POST');
    expect(parsed.resultHeight).toBe(120);
    expect(parsed.sourceName).toBe('api');
    expect(parsed.subtype).toBe('restapi');
    expect(parsed.width).toBe(360);
    expect(parsed.height).toBe(300);
    expect(parsed.timeout).toBe(8000);
  });

  test('a card without a custom size stores no size key and reads the default back', () => {
    const md = CardCodec.render(card('payload', 'rawvalue', '', '{}'));
    expect(md).not.toContain('size:');
    const parsed = CardCodec.parse('payload', md).card!;
    expect(parsed.width).toBe(290);
    expect(parsed.height).toBe(185);
  });

  test('frontmatter schema', () => {
    expect(CardCodec.validate({})).toEqual([
      'title: required',
      'source: required ({type-source}/{name-source}, or rawvalue)'
    ]);
    expect(CardCodec.validate({ title: 'A' })).toEqual([
      'source: required ({type-source}/{name-source}, or rawvalue)'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'ftp/x' })).toEqual(['source: unknown type-source']);
    expect(CardCodec.validate({ title: 'A', source: 'ftp' })).toEqual(['source: unknown type-source']);
    expect(
      CardCodec.validate({ title: 'A', source: 'mongo/db', subtype: 'find', collection: 'x', script: 'getAll' })
    ).toEqual(['script: sources have no scripts; the card holds its own code']);
    expect(
      CardCodec.validate({
        title: 'A',
        source: 'rawvalue',
        subtype: 'json',
        timeout: '999999',
        size: 'big',
        'result-height': '3'
      })
    ).toEqual([
      'timeout: must be <= 120000',
      'size: size must be {width}x{height}',
      'result-height: must be >= 24'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue', subtype: 'json', timeout: '5e3' })).toEqual([]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue', subtype: 'json', timeout: 'abc' })).toEqual([
      'timeout: expected an integer'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue', subtype: 'json', timeout: '99' })).toEqual([
      'timeout: must be >= 100'
    ]);
  });

  test('subtype is required exactly for the types that have subtypes', () => {
    const mongoList = 'find, aggregation, deleteOne, deleteMany, updateOne, updateMany, insertOne, insertMany';
    expect(CardCodec.validate({ title: 'A', source: 'mongo/db', collection: 'x' })).toEqual([
      `subtype: required for mongo (${mongoList})`
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'mongo/db', subtype: 'update', collection: 'x' })).toEqual([
      `subtype: unknown subtype "update" of mongo (${mongoList})`
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue', subtype: 'find' })).toEqual([
      'subtype: unknown subtype "find" of rawvalue (json)'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue' })).toEqual([
      'subtype: required for rawvalue (json)'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'kafka/bus', subtype: 'x' })).toEqual([
      'subtype: kafka has no subtypes'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'sql/db', subtype: 'postgres' })).toEqual([]);
  });

  test('openapi cards name their operation by id', () => {
    const create: Card = {
      varName: 'createProduct',
      title: 'Create',
      sourceType: 'openapi',
      subtype: 'restapi',
      sourceName: 'product-api',
      endpoint: 'POST /api/products',
      openapiId: 'create',
      code: ''
    };
    const md = CardCodec.render(create);
    expect(md).toBe(
      `-------------------
title: Create
source: openapi/product-api
subtype: restapi
endpoint: POST /api/products
openapi-id: create
timeout: 5000
-------------------
`
    );
    expect(CardCodec.parse('create-product', md).card!.openapiId).toBe('create');
    expect(
      CardCodec.validate({ title: 'A', source: 'mongo/db', subtype: 'find', collection: 'x', 'openapi-id': 'create' })
    ).toEqual(['openapi-id: only openapi cards name a spec operation']);
    expect(
      CardCodec.validate({ title: 'A', source: 'openapi/api', subtype: 'restapi', 'openapi-id': 'a b' })
    ).toEqual(["openapi-id: must be the spec's operationId (letters, digits, _ . -)"]);
  });

  test('mongo cards name their collection', () => {
    const find: Card = {
      varName: 'getAll',
      title: 'Get all',
      sourceType: 'mongo',
      subtype: 'find',
      collection: 'products',
      sourceName: 'db',
      code: '[ {} ]'
    };
    const md = CardCodec.render(find);
    expect(
      md.startsWith(`-------------------
title: Get all
source: mongo/db
subtype: find
collection: products
timeout: 5000
-------------------
`)
    ).toBe(true);
    expect(md).toContain('```json\n[\n  {}\n]\n```');
    expect(CardCodec.parse('get-all', md).card!.collection).toBe('products');
    expect(CardCodec.validate({ title: 'A', source: 'mongo/db', subtype: 'find' })).toEqual([
      'collection: required on mongo cards (the collection the call works on)'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'mongo/db', subtype: 'find', collection: 'system.users' })).toEqual([
      'collection: system collections cannot be used'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue', subtype: 'json', collection: 'x' })).toEqual([
      'collection: only mongo cards name a collection'
    ]);
  });

  test('sourceless types write the type alone', () => {
    expect(CardCodec.validate({ title: 'A', source: 'jsonassert/rules', subtype: 'script' })).toEqual([
      'source: jsonassert cards have no name-source (write source: jsonassert)'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'rawvalue/x', subtype: 'json' })).toEqual([
      'source: rawvalue cards have no name-source (write source: rawvalue)'
    ]);
    const check: Card = {
      varName: 'check',
      title: 'Check',
      sourceType: 'jsonassert',
      subtype: 'script',
      sourceName: '',
      code: 'assert x == 1'
    };
    expect(CardCodec.render(check)).toBe(
      `-------------------
title: Check
source: jsonassert
subtype: script
timeout: 2000
-------------------
\`\`\`jsonassert
assert x == 1
\`\`\`
`
    );
    expect(CardCodec.sourceRef(check)).toBe('jsonassert');
    expect(CardCodec.sourceRef({ sourceType: 'mongo', sourceName: 'db' })).toBe('mongo/db');
    expect(CardCodec.sourceRef({ sourceType: 'mongo', sourceName: '' })).toBe('mongo');
    expect(CardCodec.sourceRef({ sourceType: '' })).toBeNull();
  });

  test('a malformed source reference is rejected', () => {
    expect(CardCodec.validate({ title: 'A', source: 'Mongo/db' })).toEqual([
      'source: source must be {type-source} or {type-source}/{name-source}'
    ]);
    expect(CardCodec.validate({ title: 'A', source: 'mongo/db/extra' })).toEqual([
      'source: source must be {type-source} or {type-source}/{name-source}'
    ]);
  });

  test('a card without a type-source cannot be written', () => {
    const draft = card('draft', '', '', '{}');
    expect(() => FrameCodec.write({ name: 'Main', steps: [{ number: 1, cards: [draft] }] })).toThrow(FormatError);
    try {
      FrameCodec.write({ name: 'Main', steps: [{ number: 1, cards: [draft] }] });
      throw new Error('expected a FormatError');
    } catch (e) {
      expect((e as FormatError).issues).toEqual([
        'step 1 "Title of draft": source: required ({type-source}/{name-source}, or rawvalue)'
      ]);
    }
  });

  test('private notes round trip as an envelope with an empty frontmatter', () => {
    expect(CardCodec.renderPrivate('token: t')).toBe('-------------------\n-------------------\ntoken: t\n');
    expect(CardCodec.renderPrivate('')).toBe('-------------------\n-------------------\n');
    expect(CardCodec.parsePrivate('-------------------\n-------------------\ntoken: t\n')).toBe('token: t');
  });

  test('httpMethodOf reads the method of an endpoint', () => {
    expect(CardCodec.httpMethodOf('POST /api/products')).toBe('POST');
    expect(CardCodec.httpMethodOf('  get   /x ')).toBe('GET');
    expect(CardCodec.httpMethodOf('')).toBe('');
    expect(CardCodec.httpMethodOf(null)).toBe('');
    expect(CardCodec.httpMethodOf('/api/products')).toBe('');
  });

  test('toInt accepts integers only', () => {
    expect(CardCodec.toInt('5000')).toBe(5000);
    expect(CardCodec.toInt('5e3')).toBe(5000);
    expect(CardCodec.toInt('')).toBe(0);
    expect(CardCodec.toInt('1.5')).toBeNull();
    expect(CardCodec.toInt('x')).toBeNull();
    expect(CardCodec.toInt('9999999999')).toBeNull();
  });
});
