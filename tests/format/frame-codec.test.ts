import { describe, expect, test } from 'bun:test';
import * as CardCodec from '@/lib/format/card-codec';
import { FormatError } from '@/lib/format/errors';
import * as FrameCodec from '@/lib/format/frame-codec';
import { renderBody } from '@/lib/format/md-envelope';
import type { Card, CardRun, Frame, ProjectFile } from '@/lib/format/types';
import { exampleFrames } from '../helpers/example-project';

// Port of server/src/test/java/com/testframe/server/format/CardCodecTest.java (frame parts)
// and FrameCodecEmptyStepTest.java.

const json = (varName: string, code = '{ "a": 1 }'): Card => ({
  varName,
  title: `Title of ${varName}`,
  sourceType: 'rawvalue',
  subtype: 'json',
  code
});

const md = (title: string) => `-------------------\ntitle: ${title}\nsource: rawvalue\nsubtype: json\n-------------------\n`;

const byPath = (files: ProjectFile[]) => new Map(files.map((f) => [f.path, f.content]));

describe('frame codec', () => {
  test('every committed frame of the example project round trips', () => {
    const committed = exampleFrames();
    const read = FrameCodec.read(committed);
    expect(read.errors).toEqual([]);
    expect(read.frames.length).toBe(1);

    const frame = read.frames[0]!;
    expect(frame.name).toBe('active-products-echo');

    const getActive = frame.steps![0]!.cards![0]!;
    expect(getActive.varName).toBe('getActiveProducts');
    expect(getActive.type).toBe('query');
    expect(getActive.sourceType).toBe('mongo');
    expect(getActive.subtype).toBe('find');
    expect(getActive.collection).toBe('products');
    expect(getActive.code).toBe('[\n  { "ativo": true }\n]');

    const activeProducts = frame.steps![0]!.cards![1]!;
    expect(activeProducts.sourceType).toBe('rawvalue');
    expect(activeProducts.type).toBe('json');

    const assertActive = frame.steps![0]!.cards![2]!;
    expect(assertActive.sourceType).toBe('jsonassert');
    expect(assertActive.subtype).toBe('script');
    expect(assertActive.type).toBe('jsonassert');

    const createProduct = frame.steps![1]!.cards![1]!;
    expect(createProduct.sourceType).toBe('openapi');
    expect(createProduct.subtype).toBe('restapi');
    expect(createProduct.sourceName).toBe('product-api');
    expect(createProduct.httpMethod).toBe('POST');
    expect(createProduct.width).toBe(360);
    expect(createProduct.privateData).toBeNull();

    const written = FrameCodec.write(frame);
    expect(written.files.length).toBe(committed.length);
    expect(byPath(written.files)).toEqual(byPath(committed));
  });

  test('steps are numbered by position and card order comes from flow.md', () => {
    const written = FrameCodec.write({
      name: 'My Flow',
      steps: [
        { number: 7, cards: [json('first', '1'), { ...json('echoPayload'), privateData: 'secret' }] }
      ]
    });
    expect(written.dir).toBe('my-flow');
    const files = byPath(written.files);
    expect([...files.keys()].sort()).toEqual([
      'my-flow/step-1/echo-payload.md',
      'my-flow/step-1/echo-payload.private.md',
      'my-flow/step-1/first.md',
      'my-flow/step-1/flow.md'
    ]);
    expect(files.get('my-flow/step-1/flow.md')).toBe(
      '-------------------\n-------------------\nfirst\necho-payload\n'
    );
    expect(files.get('my-flow/step-1/echo-payload.private.md')).toBe('-------------------\n-------------------\nsecret\n');
  });

  test('a var-name is derived from the title when the card has none', () => {
    const written = FrameCodec.write({
      name: 'Demo',
      steps: [{ cards: [{ title: 'Echo payload', sourceType: 'rawvalue', subtype: 'json', code: '{}' }] }]
    });
    expect(written.files.map((f) => f.path)).toContain('demo/step-1/echo-payload.md');
    expect(FrameCodec.read(written.files).frames[0]!.steps![0]!.cards![0]!.varName).toBe('echoPayload');
  });

  test('empty middle and last steps round trip', () => {
    const frame: Frame = {
      name: 'Demo',
      steps: [{ cards: [json('first')] }, { cards: [] }, { cards: [json('third')] }, { cards: [] }]
    };
    const written = FrameCodec.write(frame);
    const paths = written.files.map((f) => f.path);
    expect(paths).toContain('demo/step-2/flow.md');
    expect(paths).toContain('demo/step-4/flow.md');
    expect(byPath(written.files).get('demo/step-2/flow.md')).toBe(renderBody(''));

    const back = FrameCodec.read(written.files);
    expect(back.errors).toEqual([]);
    const steps = back.frames[0]!.steps!;
    expect(steps.length).toBe(4);
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(steps[0]!.cards!.length).toBe(1);
    expect(steps[1]!.cards!.length).toBe(0);
    expect(steps[2]!.cards![0]!.varName).toBe('third');
    expect(steps[3]!.cards!.length).toBe(0);
  });

  test('a step with cards keeps its flow listing', () => {
    const written = FrameCodec.write({ name: 'Demo', steps: [{ cards: [json('alpha'), json('beta')] }] });
    expect(byPath(written.files).get('demo/step-1/flow.md')).toBe(renderBody('alpha\nbeta'));
    expect(written.files.length).toBe(3);
  });

  test('the var-name "flow" is reserved by the sequence file', () => {
    expect(() => FrameCodec.write({ name: 'Main', steps: [{ cards: [json('flow')] }] })).toThrow(
      'var-name "flow" is reserved by the step sequence file; use another name'
    );
  });

  test('duplicate and unstorable var-names are rejected', () => {
    const duplicate: Frame = {
      name: 'Main',
      steps: [{ cards: [json('getData')] }, { cards: [json('getData')] }]
    };
    try {
      FrameCodec.write(duplicate);
      throw new Error('expected a FormatError');
    } catch (e) {
      expect(e).toBeInstanceOf(FormatError);
      expect((e as FormatError).issues).toEqual([
        'var-name "getData" is used twice (step 1 "Title of getData" and step 2 "Title of getData")'
      ]);
    }

    try {
      FrameCodec.write({ name: 'Main', steps: [{ cards: [json('getHTTPData')] }] });
      throw new Error('expected a FormatError');
    } catch (e) {
      expect((e as FormatError).issues).toEqual(['var-name "getHTTPData" cannot be stored; use "getHttpdata"']);
    }
  });

  test('an invalid card is rejected with its place in the frame', () => {
    const slow: Card = { ...json('slow'), timeout: 50 };
    try {
      FrameCodec.write({ name: 'Main', steps: [{ cards: [slow] }] });
      throw new Error('expected a FormatError');
    } catch (e) {
      expect((e as FormatError).issues).toEqual(['step 1 "Title of slow": timeout: must be >= 100']);
    }

    const merge: Card = {
      varName: 'q',
      title: 'Q',
      sourceType: 'mongo',
      subtype: 'aggregation',
      collection: 'x',
      sourceName: 'db',
      code: '[[{"$merge": "y"}]]'
    };
    try {
      FrameCodec.write({ name: 'Main', steps: [{ cards: [merge] }] });
      throw new Error('expected a FormatError');
    } catch (e) {
      expect((e as FormatError).issues).toEqual([
        'step 1 "Q": code: arg 1 (pipeline): stage "$merge" is not allowed in mongo cards'
      ]);
    }
  });

  test('every problem of a frame is reported at once', () => {
    const a: Card = { varName: 'a', title: 'A', sourceType: '', code: '{}' };
    const b: Card = { varName: 'b', title: 'B', sourceType: 'mongo', sourceName: 'db', code: '' };
    try {
      FrameCodec.write({ name: 'Main', steps: [{ cards: [a, b] }] });
      throw new Error('expected a FormatError');
    } catch (e) {
      expect((e as FormatError).issues).toEqual([
        'step 1 "A": source: required ({type-source}/{name-source}, or rawvalue)',
        'step 1 "B": subtype: required for mongo (find, aggregation, deleteOne, deleteMany, updateOne, updateMany, insertOne, insertMany)',
        'step 1 "B": collection: required on mongo cards (the collection the call works on)'
      ]);
    }
  });

  test('read reports invalid files and orphan private notes', () => {
    const files: ProjectFile[] = [
      { path: 'main/step-1/a.md', content: '-------------------\nsource: rawvalue\nsubtype: json\n-------------------\n' },
      { path: 'main/step-1/b.private.md', content: '-------------------\n-------------------\nx\n' },
      { path: 'main/step-1/c.md', content: '-------------------\ntitle: C\n-------------------\n' },
      { path: 'main/notes.md', content: 'x' }
    ];
    const read = FrameCodec.read(files);
    expect(read.errors).toEqual([
      'main/step-1/a.md: title: required',
      'main/step-1/c.md: source: required ({type-source}/{name-source}, or rawvalue)',
      'main/notes.md: path must be {frame}/step-{n}/{var-name}.md',
      'main/step-1/b: private data without a card (main/step-1/b.md missing)'
    ]);
    expect(read.frames).toEqual([]);
  });

  test('a flow.md mismatch is reported and never silently lost', () => {
    const files: ProjectFile[] = [
      { path: 'main/step-1/a.md', content: md('A') },
      { path: 'main/step-1/b.md', content: md('B') },
      { path: 'main/step-1/flow.md', content: '-------------------\n-------------------\nb\nghost\n' }
    ];
    const read = FrameCodec.read(files);
    expect(read.errors).toEqual([
      'main/step-1/flow.md: ghost.md is listed but the card file is missing',
      'main/step-1/a.md: not listed in flow.md'
    ]);
    expect(read.frames[0]!.steps![0]!.cards!.map((c) => c.varName)).toEqual(['b', 'a']);
  });

  test('a zero-padded step folder still uses its flow.md (same as the plugin decoder)', () => {
    const files: ProjectFile[] = [
      { path: 'main/step-01/a.md', content: md('A') },
      { path: 'main/step-01/b.md', content: md('B') },
      { path: 'main/step-01/flow.md', content: '-------------------\n-------------------\nb\na\n' }
    ];
    const read = FrameCodec.read(files);
    expect(read.errors).toEqual([]);
    expect(read.frames[0]!.steps![0]!.cards!.map((c) => c.varName)).toEqual(['b', 'a']);
  });

  test('a card listed twice in flow.md is reported once', () => {
    const files: ProjectFile[] = [
      { path: 'main/step-1/a.md', content: md('A') },
      { path: 'main/step-1/flow.md', content: '-------------------\n-------------------\na\na.md\n' }
    ];
    const read = FrameCodec.read(files);
    expect(read.errors).toEqual(['main/step-1/flow.md: a.md is listed twice']);
    expect(read.frames[0]!.steps![0]!.cards!.map((c) => c.varName)).toEqual(['a']);
  });

  test('a step without a flow.md keeps its cards in file-name order', () => {
    const read = FrameCodec.read([
      { path: 'main/step-1/b.md', content: md('B') },
      { path: 'main/step-1/a.md', content: md('A') }
    ]);
    expect(read.errors).toEqual([]);
    expect(read.frames[0]!.steps![0]!.cards!.map((c) => c.varName)).toEqual(['a', 'b']);
  });

  test('read sorts frames by name, steps numerically and cards by flow', () => {
    const run: CardRun = { status: 'error', text: 'boom', output: '', elapsedMs: 1, ranAt: null };
    const files: ProjectFile[] = [
      { path: 'zebra/step-1/y.md', content: md('Y') },
      { path: 'zebra/step-1/flow.md', content: renderBody('y') },
      { path: 'main/step-10/z.md', content: md('Z') },
      { path: 'main/step-10/flow.md', content: renderBody('z') },
      { path: 'main/step-2/b.md', content: md('B') },
      { path: 'main/step-2/c.md', content: md('C') },
      { path: 'main/step-2/flow.md', content: renderBody('c\nb') }
    ];
    const read = FrameCodec.read(files, new Map([['main/step-2/c', run]]));
    expect(read.errors).toEqual([]);
    expect(read.frames.map((f) => f.name)).toEqual(['main', 'zebra']);
    const frame = read.frames[0]!;
    expect(frame.steps!.map((s) => s.number)).toEqual([1, 2]);
    expect(frame.steps![0]!.cards!.map((c) => c.varName)).toEqual(['c', 'b']);
    expect(frame.steps![0]!.cards![0]!.lastRun).toEqual(run);
    expect(frame.steps![0]!.cards![1]!.lastRun).toBeNull();
    expect(frame.steps![1]!.cards![0]!.varName).toBe('z');
  });

  test('private notes are attached to their card', () => {
    const read = FrameCodec.read([
      { path: 'main/step-1/a.md', content: md('A') },
      { path: 'main/step-1/a.private.md', content: CardCodec.renderPrivate('token: t') },
      { path: 'main/step-1/flow.md', content: renderBody('a') }
    ]);
    expect(read.errors).toEqual([]);
    expect(read.frames[0]!.steps![0]!.cards![0]!.privateData).toBe('token: t');
  });

  test('cardBase and dirOf build the on-disk identity', () => {
    expect(FrameCodec.dirOf('My Flow')).toBe('my-flow');
    expect(FrameCodec.cardBase('My Flow', 2, 'getActiveProducts')).toBe('my-flow/step-2/get-active-products');
    expect(FrameCodec.varNameOf({ title: 'Get active products' })).toBe('getActiveProducts');
    expect(FrameCodec.varNameOf({ varName: 'explicit', title: 'Get active products' })).toBe('explicit');
    expect(FrameCodec.FLOW_FILE).toBe('flow.md');
  });

  test('a frame without steps writes nothing', () => {
    expect(FrameCodec.write({ name: 'Empty' }).files).toEqual([]);
    expect(FrameCodec.write({ name: 'Empty', steps: [] }).files).toEqual([]);
    expect(FrameCodec.read([]).frames).toEqual([]);
  });
});
