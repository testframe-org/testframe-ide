import type { HttpResult } from '../types';

// Dispatches a flow card request against any target endpoint (example APIs,
// sources configured on the card). Reports timing for the execution console.
export async function runTargetRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResult> {
  const startedAt = performance.now();
  try {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - startedAt);
    return { ok: res.ok, status: res.status, statusText: res.statusText, ms, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: 'NETWORK',
      ms: Math.round(performance.now() - startedAt),
      text: String(err)
    };
  }
}
