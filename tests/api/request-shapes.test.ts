import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as framesRoute } from '@/app/api/v2/frames/route';
import { POST as mongoRoute } from '@/app/api/v2/run/mongo/route';
import { POST as validateRoute } from '@/app/api/v2/validate/route';
import type { Services } from '@/lib/services/context';
import { RunService } from '@/lib/services/run-service';
import { PROTOCOL, RunnerClient } from '@/lib/services/runner-client';
import { tmpProject, writeLayers, type TmpProject } from '../helpers/tmp-project';

// A request body of the wrong shape is a 400 naming the field, never a 500. The routes are where
// JSON becomes the typed shapes lib/ works with, and the format functions read those fields as the
// strings and numbers they are declared to be: `code: 5` used to be a TypeError inside the codec.

const IDE = 'http://localhost:15198';
const servicesKey = Symbol.for('testframe.services');

let tmp: TmpProject | null = null;
afterEach(() => {
  tmp?.cleanup();
  tmp = null;
  delete (globalThis as Record<symbol, unknown>)[servicesKey];
});

interface Call {
  url: string;
  body: unknown;
}

/** Installs a scratch project whose plugin is a fake that records what it was asked to run. */
function install(layers: Record<string, string>): { tmp: TmpProject; calls: Call[] } {
  const project = (tmp = tmpProject());
  writeLayers(project, layers);
  const calls: Call[] = [];
  const runner = new RunnerClient('http://runner.test', undefined, async (url, init) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return url.endsWith('/api/v1/health')
      ? Response.json({ name: 'plugin', version: '1', protocol: PROTOCOL })
      : Response.json({ result: { varName: 'mongoCall', status: 'success', text: 'ok' } });
  });
  const services: Services = {
    ...project.services,
    runner,
    runs: new RunService(project.services.sources, project.services.openApi, runner)
  };
  (globalThis as Record<symbol, unknown>)[servicesKey] = services;
  return { tmp: project, calls };
}

function post(route: string, body: unknown): NextRequest {
  return new NextRequest(`${IDE}${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { host: 'localhost:15198', 'content-type': 'application/json' }
  } as ConstructorParameters<typeof NextRequest>[1]);
}

interface Answer {
  status?: number;
  message?: string;
  problem?: string | null;
  problems?: string[];
  formatted?: string | null;
}

const answer = async (res: Response) => (await res.json()) as Answer;

describe('POST /api/v2/validate: a field of the wrong type is a 400', () => {
  test('a non-string code is refused for every rule that reads it', async () => {
    for (const [sourceType, subtype] of [
      ['sql', 'oracle'],
      ['mongo', 'find'],
      ['jsonassert', 'script']
    ] as const) {
      for (const code of [5, true, ['a'], { a: 1 }]) {
        const res = await validateRoute(post('/api/v2/validate', { sourceType, subtype, code }));
        expect(res.status).toBe(400);
        expect((await answer(res)).message).toBe('code must be a string');
      }
    }
  });

  test('a non-string sourceType or subtype is refused too', async () => {
    for (const body of [{ sourceType: 5, code: 'x' }, { sourceType: 'mongo', subtype: 5, code: '[]' }]) {
      const res = await validateRoute(post('/api/v2/validate', body));
      expect(res.status).toBe(400);
      expect((await answer(res)).message).toContain('must be a string');
    }
  });

  test('a string code still validates, and a body without one is an empty draft', async () => {
    const invalid = await answer(
      await validateRoute(post('/api/v2/validate', { sourceType: 'sql', subtype: 'oracle', code: 'delete from x' }))
    );
    expect(invalid.problems).toEqual(['oracle cards accept a single SELECT statement']);
    const valid = await answer(
      await validateRoute(post('/api/v2/validate', { sourceType: 'mongo', subtype: 'find', code: '[ {"ativo": true} ]' }))
    );
    expect(valid).toEqual({ problem: null, problems: [], formatted: '[\n  { "ativo": true }\n]' });
    const draft = await answer(await validateRoute(post('/api/v2/validate', { sourceType: 'sql', subtype: 'oracle' })));
    expect(draft).toEqual({ problem: null, problems: [], formatted: null });
  });
});

describe('POST /api/v2/frames: a card of the wrong shape is a 400', () => {
  const layers = { 'sources.yaml': 'environments: [hml]\n' };
  const frame = (card: unknown) => ({ project: 'demo', frame: { name: 'main', steps: [{ cards: [card] }] } });

  test('a non-string code names the step, the card and the field, and writes nothing', async () => {
    const { tmp: t } = install(layers);
    for (const card of [
      { varName: 'aCard', title: 'A', sourceType: 'sql', subtype: 'oracle', code: 5 },
      { varName: 'aCard', title: 'A', sourceType: 'mongo', sourceName: 'db', subtype: 'find', collection: 'c', code: ['{}'] },
      { varName: 'aCard', title: 5, sourceType: 'sql', subtype: 'oracle', code: 'select 1 from dual' },
      { varName: 'aCard', title: 'A', sourceType: 'sql', subtype: 'oracle', code: 'select 1 from dual', timeout: '5000' }
    ]) {
      const res = await framesRoute(post('/api/v2/frames', frame(card)));
      expect(res.status).toBe(400);
      const body = await answer(res);
      expect(body.problems?.length).toBe(1);
      expect(body.problems?.[0]).toStartWith('step 1, card 1: ');
      expect(body.problems?.[0]).toContain('must be a');
    }
    expect(existsSync(path.join(t.testframeDir, 'frames'))).toBe(false);
  });

  test('a frame, step or card that is not the shape it is declared to be is a 400', async () => {
    install(layers);
    for (const body of [
      { project: 'demo', frame: { name: 'main', steps: 5 } },
      { project: 'demo', frame: { name: 'main', steps: [{ cards: {} }] } },
      { project: 'demo', frame: { name: 'main', steps: [null] } },
      { project: 'demo', frame: { name: 'main', steps: [{ cards: ['a-card'] }] } }
    ]) {
      const res = await framesRoute(post('/api/v2/frames', body));
      expect(res.status).toBe(400);
      expect((await answer(res)).problems?.length).toBe(1);
    }
  });

  test('a well-formed frame is still saved', async () => {
    const { tmp: t } = install(layers);
    const res = await framesRoute(
      post('/api/v2/frames', frame({ varName: 'aCard', title: 'A', sourceType: 'sql', subtype: 'oracle', code: 'select 1 from dual' }))
    );
    expect(res.status).toBe(200);
    expect(existsSync(path.join(t.testframeDir, 'frames/main/step-1/a-card.md'))).toBe(true);
  });
});

describe('POST /api/v2/run/mongo: the call body is the JSON array text', () => {
  const layers = { 'sources.yaml': 'environments: [hml]\nmongo:\n  db:\n    base-url: mongodb://localhost:27017/x\n' };
  const call = (body: unknown) => ({ project: 'demo', environment: 'hml', source: 'db', subtype: 'find', collection: 'products', body });

  test('a body that is not a string is a 400 and the plugin is never called', async () => {
    const { calls } = install(layers);
    // `undefined` is what a request without the field carries once it went through JSON
    for (const body of [5, [{ ativo: true }], { ativo: true }, null, undefined, '   ']) {
      const res = await mongoRoute(post('/api/v2/run/mongo', call(body)));
      expect(res.status).toBe(400);
      expect((await answer(res)).message).toBe('body is required (the JSON array of the call arguments, as a string)');
    }
    expect(calls.filter((c) => c.url.endsWith('/api/v1/run/card'))).toEqual([]);
  });

  test('a string body reaches the plugin as the card code', async () => {
    const { calls } = install(layers);
    const res = await mongoRoute(post('/api/v2/run/mongo', call('[ { "ativo": true } ]')));
    expect(res.status).toBe(200);
    const run = calls.find((c) => c.url.endsWith('/api/v1/run/card'));
    expect((run?.body as { card: { code: string; sourceType: string } }).card.code).toBe('[ { "ativo": true } ]');
    expect((run?.body as { card: { sourceType: string } }).card.sourceType).toBe('mongo');
  });
});
