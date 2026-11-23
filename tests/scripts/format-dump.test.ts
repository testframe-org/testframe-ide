import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { tmpProject, writeLayers } from '@/tests/helpers/tmp-project';
import { FORMAT, PRIVATE, dumpProject } from '@/scripts/format-dump';

// The TypeScript side of the format parity gate (repo-root scripts/format-check.ts): the canonical
// dump the plugin's `format-dump` must match, field by field.

const card = (frontmatter: string, body: string) => `-------------------\n${frontmatter}\n-------------------\n${body}`;
const flow = (...entries: string[]) => `-------------------\n-------------------\n${entries.join('\n')}\n`;

describe('format-dump', () => {
  test('dumps frames and cards in the canonical projection', async () => {
    const tmp = tmpProject();
    try {
      tmp.write('frames/demo/step-1/flow.md', flow('get-products', 'total'));
      tmp.write('frames/demo/step-1/get-products.md', card(
        'title: Get products\nsource: mongo/products-db\nsubtype: find\ncollection: products',
        '```json\n[\n  { "ativo": true }\n]\n```'
      ));
      tmp.write('frames/demo/step-1/total.md', card(
        'title: Total\nsource: rawvalue\nsubtype: json\ntimeout: 1500',
        '```json\n0\n```'
      ));
      writeLayers(tmp, { 'sources.yaml': 'environments: [local]\nmongo:\n  products-db:\n    base-url: mongodb://localhost:27017/products\n' });

      const dump = await dumpProject(path.dirname(tmp.testframeDir));
      expect(dump.format).toBe(FORMAT);
      expect(dump.project).toBe('demo');
      expect(dump.frameProblems).toEqual([]);
      expect(dump.frames.map((f) => f.name)).toEqual(['demo']);

      const [mongo, raw] = dump.frames[0]!.steps[0]!.cards;
      expect(mongo).toEqual({
        varName: 'getProducts',
        title: 'Get products',
        type: 'query',
        sourceType: 'mongo',
        sourceName: 'products-db',
        subtype: 'find',
        collection: 'products',
        endpoint: null,
        openapiId: null,
        timeout: 5000, // absent in the file: the card type's default
        code: '[\n  { "ativo": true }\n]'
      });
      expect(raw).toMatchObject({ varName: 'total', sourceType: 'rawvalue', sourceName: null, timeout: 1500, code: '0' });

      expect(dump.sources).toEqual({
        environments: ['local'],
        declared: ['mongo/products-db'],
        problems: [],
        resolved: [{
          environment: 'local',
          sources: [{
            ref: 'mongo/products-db',
            baseUrl: 'mongodb://localhost:27017/products',
            configured: true,
            headers: {},
            privateFields: []
          }]
        }]
      });
    } finally {
      tmp.cleanup();
    }
  });

  test('an invalid card is reported and dropped, as the plugin does', async () => {
    const tmp = tmpProject();
    try {
      tmp.write('frames/demo/step-1/flow.md', flow('broken'));
      tmp.write('frames/demo/step-1/broken.md', card('title: Broken\nsource: rawvalue', '```json\n1\n```'));
      writeLayers(tmp, { 'sources.yaml': 'environments: [local]\n' });

      const dump = await dumpProject(path.dirname(tmp.testframeDir));
      expect(dump.frames[0]!.steps[0]!.cards).toEqual([]);
      // The reader drops the invalid card, so its flow.md entry reads as missing too. The plugin's
      // decoders keep an invalid card best effort and report only the card problem: on a malformed
      // project `bun run format:check` shows this difference (reported, not papered over).
      expect(dump.frameProblems).toEqual([
        'demo/step-1/broken.md: subtype: required for rawvalue (json)',
        'demo/step-1/flow.md: broken.md is listed but the card file is missing'
      ]);
    } finally {
      tmp.cleanup();
    }
  });

  test('private notes are not part of the parity', async () => {
    const tmp = tmpProject();
    try {
      tmp.write('frames/demo/step-1/flow.md', flow('kept'));
      tmp.write('frames/demo/step-1/kept.md', card('title: Kept\nsource: rawvalue\nsubtype: json', '```json\n1\n```'));
      tmp.write('frames/demo/step-1/kept.private.md', '-------------------\n-------------------\nX-Api-Key: secret\n');
      // an orphan private note is a local draft: the plugin never reads it, so the dump ignores it
      tmp.write('frames/demo/step-1/orphan.private.md', '-------------------\n-------------------\nnote\n');
      writeLayers(tmp, { 'sources.yaml': 'environments: [local]\n' });

      const dump = await dumpProject(path.dirname(tmp.testframeDir));
      expect(dump.frameProblems).toEqual([]);
      expect(dump.frames[0]!.steps[0]!.cards.map((c) => c.varName)).toEqual(['kept']);
      expect(JSON.stringify(dump)).not.toContain('secret');
    } finally {
      tmp.cleanup();
    }
  });

  test('resolves every environment and masks private values', async () => {
    const tmp = tmpProject();
    try {
      writeLayers(tmp, {
        'sources.yaml': [
          'environments: [local, hml]',
          'openapi:',
          '  product-api:',
          '    base-url: http://localhost:18081/api/docs/openapi.json',
          'mongo:',
          '  products-db:',
          '    base-url: mongodb://localhost:27017/products',
          ''
        ].join('\n'),
        'sources.hml.yaml': [
          'openapi:',
          '  product-api:',
          '    base-url: https://api.{env}.example.com/openapi.json',
          '    headers:',
          '      X-Api-Key: hml-key',
          ''
        ].join('\n'),
        'sources.hml.private.yaml': 'mongo:\n  products-db:\n    base-url: mongodb://app:s3cret@hml.example.com:27017/products\n'
      });
      tmp.write('frames/demo/step-1/flow.md', flow());

      const dump = await dumpProject(path.dirname(tmp.testframeDir));
      expect(dump.sources.environments).toEqual(['local', 'hml']);
      expect(dump.sources.declared).toEqual(['openapi/product-api', 'mongo/products-db']);
      expect(dump.sources.problems).toEqual([]);

      const [local] = dump.sources.resolved;
      expect(local!.sources[0]).toMatchObject({
        ref: 'openapi/product-api',
        baseUrl: 'http://localhost:18081/api/docs/openapi.json',
        configured: true,
        privateFields: []
      });

      const [, hml] = dump.sources.resolved;
      expect(hml!.sources[0]).toMatchObject({
        baseUrl: 'https://api.hml.example.com/openapi.json', // {env} substituted
        headers: { 'x-api-key': 'hml-key' } // names lower-case
      });
      expect(hml!.sources[1]).toEqual({
        ref: 'mongo/products-db',
        baseUrl: PRIVATE, // a value whose winning layer is private is never printed
        configured: true,
        headers: {},
        privateFields: ['base-url']
      });
      expect(JSON.stringify(dump)).not.toContain('s3cret');
    } finally {
      tmp.cleanup();
    }
  });

  test('invalid sources are reported without a resolution', async () => {
    const tmp = tmpProject();
    try {
      writeLayers(tmp, { 'sources.yaml': 'openapi:\n  product-api:\n    base-url: http://x/openapi.json\n' });

      const dump = await dumpProject(path.dirname(tmp.testframeDir));
      expect(dump.sources.environments).toEqual([]);
      expect(dump.sources.resolved).toEqual([]);
      expect(dump.sources.problems).toEqual(['sources.yaml: environments: required (e.g. environments: [local])']);
    } finally {
      tmp.cleanup();
    }
  });
});
