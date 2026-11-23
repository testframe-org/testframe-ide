import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from '@/lib/format/errors';
import { saveSources } from '@/lib/services/sources-save';
import { renameSource } from '@/lib/sources/source-rename';
import { PRIVATE_MARKER } from '@/lib/sources/sources-yaml';
import { tmpProject, writeLayers, type TmpProject } from '../helpers/tmp-project';

// POST /api/v2/sources replaces the project's layer files (agents/specs/project-format.md,
// "Sources"): whatever the sent model does not hold is deleted, a body that is not a model is
// refused before anything is written, and a source the editor renamed keeps the private values
// stored under its old name instead of asking for them again.

const offline = async () => {
  throw new Error('offline');
};

let tmp: TmpProject | null = null;
afterEach(() => {
  tmp?.cleanup();
  tmp = null;
});

function setup(layers: Record<string, string>): TmpProject {
  const t = (tmp = tmpProject('demo', offline));
  writeLayers(t, layers);
  return t;
}

const save = (t: TmpProject, body: Record<string, unknown>) => saveSources(t.services, { project: 'demo', env: 'hml', ...body });

describe('POST /api/v2/sources: what the model does not hold is deleted', () => {
  test('a bogus layer file and an unlisted environment\'s layers are dropped by a save', async () => {
    const t = setup({
      'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n',
      'sources.a.b.yaml': 'openapi: {}\n',
      'sources.other.yaml': 'openapi:\n  api:\n    base-url: http://other\n',
      'sources.hml.yaml': 'openapi:\n  api:\n    base-url: http://hml\n'
    });
    const result = await save(t, {
      environments: ['hml'],
      layers: { base: { openapi: { api: { 'base-url': 'http://api' } } }, private: {}, env: {} }
    });
    expect(result.removed).toBe(3);
    for (const gone of ['sources.a.b.yaml', 'sources.other.yaml', 'sources.hml.yaml']) {
      expect(existsSync(path.join(t.testframeDir, gone))).toBe(false);
    }
    expect(t.read('sources.yaml')).toContain('base-url: http://api');
    // ...and the bogus file is not reported again on the next read
    expect((await t.services.sources.load('demo')).errors).toEqual([]);
  });

  test('a body that is not a model is a 400 and rewrites nothing', async () => {
    const t = setup({ 'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n' });
    const before = t.read('sources.yaml');
    for (const layers of [5, 'x', null, undefined, []]) {
      const error = await save(t, { environments: ['hml'], layers }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toContain('sources: layers: expected a map');
    }
    expect(t.read('sources.yaml')).toBe(before);
  });

  test('an env section of the wrong shape is a 400 too', async () => {
    const t = setup({ 'sources.yaml': 'environments: [hml]\n' });
    const error = await save(t, {
      environments: ['hml'],
      layers: { base: {}, private: {}, env: { hml: 'public' } }
    }).catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toContain('sources: layers.env.hml: expected a map (public, private)');
  });
});

describe('POST /api/v2/sources: renaming a source carries its private values over', () => {
  const LAYERS = {
    'sources.yaml': 'environments: [hml]\nopenapi:\n  api:\n    base-url: http://api\n    headers:\n      X-Public: pub\n',
    'sources.private.yaml': 'openapi:\n  api:\n    headers:\n      Authorization: Bearer base-token\n',
    'sources.hml.private.yaml': 'openapi:\n  api:\n    base-url: http://u:hml-pass@api-hml\n'
  };

  /** The model the editor holds: the stored one, masked, with openapi/api renamed. */
  async function renamed(t: TmpProject) {
    const { errors: _errors, ...masked } = await t.services.sources.view('demo');
    return renameSource(masked, 'openapi', 'api', 'api-v2');
  }

  test('the secret survives under the new name; the marker is never written to disk', async () => {
    const t = setup(LAYERS);
    const sent = await renamed(t);
    const result = await save(t, {
      environments: sent.environments,
      layers: sent.layers,
      renames: [{ type: 'openapi', from: 'api', to: 'api-v2' }]
    });
    expect(result.saved).toBe(3);
    expect(t.read('sources.yaml')).toContain('api-v2:');
    expect(t.read('sources.private.yaml')).toBe('openapi:\n  api-v2:\n    headers:\n      Authorization: Bearer base-token\n');
    expect(t.read('sources.hml.private.yaml')).toBe('openapi:\n  api-v2:\n    base-url: http://u:hml-pass@api-hml\n');
    for (const file of ['sources.yaml', 'sources.private.yaml', 'sources.hml.private.yaml']) {
      expect(t.read(file)).not.toContain(PRIVATE_MARKER);
    }
    // and the value is still masked on the way back out
    const again = JSON.stringify(await t.services.sources.view('demo'));
    for (const secret of ['base-token', 'hml-pass']) expect(again).not.toContain(secret);
  });

  test('renaming twice before saving still carries the values', async () => {
    const t = setup(LAYERS);
    const once = await renamed(t);
    const twice = renameSource(once, 'openapi', 'api-v2', 'api-v3');
    await save(t, {
      environments: twice.environments,
      layers: twice.layers,
      // what the editor sends: one entry per source, from the name on disk to the current one
      renames: [{ type: 'openapi', from: 'api', to: 'api-v3' }]
    });
    expect(t.read('sources.private.yaml')).toBe('openapi:\n  api-v3:\n    headers:\n      Authorization: Bearer base-token\n');
  });

  test('without the rename the save is refused instead of writing the marker', async () => {
    const t = setup(LAYERS);
    const sent = await renamed(t);
    const error = await save(t, { environments: sent.environments, layers: sent.layers }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toContain('no stored private value to keep');
    expect((error as ApiError).problems).toEqual([
      'sources.private.yaml: openapi.api-v2.headers.Authorization: no stored private value to keep (type the value again)',
      'sources.hml.private.yaml: openapi.api-v2.base-url: no stored private value to keep (type the value again)'
    ]);
    // nothing was written: the stored values are still there under the old name
    expect(t.read('sources.private.yaml')).toBe(LAYERS['sources.private.yaml']);
    expect(t.read('sources.hml.private.yaml')).toBe(LAYERS['sources.hml.private.yaml']);
  });

  test('a rename that would hand a secret to another source is refused', async () => {
    const t = setup(LAYERS);
    const { errors: _errors, ...masked } = await t.services.sources.view('demo');
    // "api" is kept and a new "api-v2" asks for its stored value
    masked.layers.base.openapi!['api-v2'] = {};
    masked.layers.private.openapi!['api-v2'] = { headers: { Authorization: PRIVATE_MARKER } };
    const error = await save(t, {
      environments: masked.environments,
      layers: masked.layers,
      renames: [{ type: 'openapi', from: 'api', to: 'api-v2' }]
    }).catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toContain('openapi.api-v2.headers.Authorization: no stored private value to keep');
    expect(t.read('sources.private.yaml')).toBe(LAYERS['sources.private.yaml']);
  });
});
