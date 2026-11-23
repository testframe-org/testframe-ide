import { describe, expect, test } from 'bun:test';
import { ApiError } from '@/lib/format/errors';
import { PROTOCOL, RunnerClient, shownUrl } from '@/lib/services/runner-client';

// The IDE's client of the runner plugin (agents/specs/runner-protocol.md): runs answer 503 unless the
// plugin is configured, up and speaks the IDE's protocol; the token is added server-side only and
// the health answer (which reaches the browser) never carries user-info or the token.

type Call = { url: string; init?: RequestInit };

function fake(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url);
  };
  return { calls, fetchImpl };
}

const healthy = () => Response.json({ name: 'plugin', version: '1', protocol: PROTOCOL });

async function status(p: Promise<unknown>): Promise<number | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
}

describe('RunnerClient: availability', () => {
  test('unconfigured: health says so and a run is a 503 without any network call', async () => {
    const { calls, fetchImpl } = fake(healthy);
    const client = new RunnerClient(undefined, undefined, fetchImpl);
    expect((await client.health()).status).toBe('unconfigured');
    expect(await status(client.post('/api/v1/run', {}, 'application/json', 1000))).toBe(503);
    expect(await status(client.forward(new Request('http://localhost/x'), '/api/v1/tour/projects'))).toBe(503);
    expect(calls).toEqual([]);
  });

  test('down: health is "down" and a run is a 503', async () => {
    const { fetchImpl } = fake(() => {
      throw new Error('ECONNREFUSED');
    });
    const client = new RunnerClient('http://runner.test', undefined, fetchImpl);
    const health = await client.health(true);
    expect(health.status).toBe('down');
    expect(await status(client.post('/api/v1/run', {}, 'application/json', 1000))).toBe(503);
  });

  test('a non-2xx health is "down"', async () => {
    const { fetchImpl } = fake(() => new Response('no', { status: 500 }));
    expect((await new RunnerClient('http://runner.test', undefined, fetchImpl).health(true)).status).toBe('down');
  });

  test('another protocol: health is "incompatible" and a run is a 503', async () => {
    const { calls, fetchImpl } = fake(() => Response.json({ protocol: PROTOCOL + 1 }));
    const client = new RunnerClient('http://runner.test', undefined, fetchImpl);
    expect((await client.health(true)).status).toBe('incompatible');
    expect(await status(client.post('/api/v1/run', {}, 'application/json', 1000))).toBe(503);
    expect(calls.every((c) => c.url.endsWith('/api/v1/health'))).toBe(true);
  });
});

describe('RunnerClient: the token stays server-side', () => {
  test('Authorization: Bearer is added to plugin calls when a token is configured', async () => {
    const { calls, fetchImpl } = fake((url) => (url.endsWith('/health') ? healthy() : Response.json({})));
    const client = new RunnerClient('http://runner.test/', 'plugin-token', fetchImpl);
    await client.post('/api/v1/run', { a: 1 }, 'application/json', 1000);
    expect(calls.map((c) => c.url)).toEqual(['http://runner.test/api/v1/health', 'http://runner.test/api/v1/run']);
    for (const c of calls) expect(new Headers(c.init!.headers).get('authorization')).toBe('Bearer plugin-token');
  });

  test('no token configured: no Authorization header at all', async () => {
    const { calls, fetchImpl } = fake((url) => (url.endsWith('/health') ? healthy() : Response.json({})));
    await new RunnerClient('http://runner.test', undefined, fetchImpl).post('/api/v1/run', {}, 'application/json', 1000);
    for (const c of calls) expect(new Headers(c.init!.headers).has('authorization')).toBe(false);
  });

  test('forward: the browser\'s own Authorization and Cookie are dropped, the configured token is used', async () => {
    const { calls, fetchImpl } = fake(() => Response.json({}));
    const client = new RunnerClient('http://runner.test', 'plugin-token', fetchImpl);
    await client.forward(new Request('http://localhost/api/tour/projects', {
      headers: { authorization: 'Bearer from-browser', cookie: 'a=b', accept: 'application/json', 'x-other': '1' }
    }), '/api/v1/tour/projects');
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get('authorization')).toBe('Bearer plugin-token');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-other')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
  });

  test('health never returns the URL user-info or the token, up or down', async () => {
    const url = 'http://admin:pw-secret@runner.test:18080';
    const up = await new RunnerClient(url, 'plugin-token', fake(healthy).fetchImpl).health(true);
    expect(up.url).toBe('http://runner.test:18080');
    const down = await new RunnerClient(url, 'plugin-token', fake(() => {
      throw new Error(`fetch failed for ${url}/api/v1/health with plugin-token`);
    }).fetchImpl).health(true);
    expect(down.status).toBe('down');
    const text = JSON.stringify([up, down]);
    expect(text).not.toContain('pw-secret');
    expect(text).not.toContain('admin:');
    expect(text).not.toContain('plugin-token');
  });

  test('shownUrl removes user-info and keeps everything else', () => {
    expect(shownUrl('http://u:p@h:1/x?q=1')).toBe('http://h:1/x?q=1');
    expect(shownUrl('http://h:1')).toBe('http://h:1');
    expect(shownUrl('not a url u:p@x')).toBe('not a url u:p@x');
  });
});
