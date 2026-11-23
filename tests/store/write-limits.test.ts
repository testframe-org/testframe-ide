import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '@/lib/format/errors';
import { FRAMES_DIR, MAX_FILE_BYTES, ProjectStore } from '@/lib/store/project-store';
import { tmpProject } from '../helpers/tmp-project';

// agents/specs/project-format.md, "File size": the store never writes a file it would not read back
// (over MAX_FILE_BYTES). Such a save is a 400 before anything is written — otherwise the file
// would be skipped on the next load and pruned by the next save (silent loss).

const over = 'x'.repeat(MAX_FILE_BYTES + 1);
// multi-byte characters: under the limit in characters, over it in bytes
const overInBytes = 'é'.repeat(MAX_FILE_BYTES / 2 + 1);

async function refused(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(400);
  return e as ApiError;
}

describe('project store: 2 MiB per file on write', () => {
  test('a frame save with one oversized card writes nothing and prunes nothing', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [{ path: 'main/step-1/kept.md', content: 'old' }]);
      for (const big of [over, overInBytes]) {
        const e = await refused(store.replace('demo', FRAMES_DIR, ['main'], [], [
          { path: 'main/step-1/new.md', content: 'new' },
          { path: 'main/step-1/big.md', content: big }
        ]));
        expect(e.message).toBe(`main/step-1/big.md: larger than ${MAX_FILE_BYTES} bytes, not written`);
      }
      expect(tmp.names('frames/main/step-1')).toEqual(['kept.md']);
      expect(tmp.read('frames/main/step-1/kept.md')).toBe('old');
    } finally {
      tmp.cleanup();
    }
  });

  test('exactly MAX_FILE_BYTES is written', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await store.replace('demo', FRAMES_DIR, ['main'], [], [{ path: 'main/step-1/edge.md', content: 'x'.repeat(MAX_FILE_BYTES) }]);
      expect(tmp.read('frames/main/step-1/edge.md').length).toBe(MAX_FILE_BYTES);
    } finally {
      tmp.cleanup();
    }
  });

  test('a sources save with one oversized layer writes and removes nothing', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      tmp.write('sources.yaml', 'environments: [hml]\n');
      tmp.write('sources.hml.yaml', 'openapi: {}\n');
      await refused(store.writeSourceLayers('demo', new Map([
        ['sources.yaml', 'environments: [hml, prod]\n'],
        ['sources.private.yaml', `# ${over}`]
      ]), ['sources.hml.yaml']));
      expect(tmp.read('sources.yaml')).toBe('environments: [hml]\n');
      expect(tmp.names('.')).toEqual(['sources.hml.yaml', 'sources.yaml']);
    } finally {
      tmp.cleanup();
    }
  });

  test('atomic writes leave no temporary file behind', async () => {
    const tmp = tmpProject();
    try {
      const store = new ProjectStore(tmp.root);
      await Promise.all([1, 2, 3].map((n) => store.replace('demo', FRAMES_DIR, ['main'], [], [{ path: 'main/step-1/a.md', content: `v${n}` }])));
      expect(readdirSync(path.join(tmp.testframeDir, 'frames/main/step-1'))).toEqual(['a.md']);
    } finally {
      tmp.cleanup();
    }
  });
});
