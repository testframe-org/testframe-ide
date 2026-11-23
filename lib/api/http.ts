import { ApiError, FormatError } from '../format/errors';

// Route handler helpers: every failure answers `{status, message}` (plus `problems` when there
// is a list), so the editor can show the reason.
//
// Every route goes through `handle(request, fn)`, which first applies the request guard (deny by
// default): the IDE is a loopback tool, so a request must name a loopback host (DNS rebinding),
// and a state-changing request must not come from another origin (CSRF: `Sec-Fetch-Site` other
// than `same-origin`/`none`, or an `Origin` that is not the request's own host, is a 403).
// `readJson` additionally refuses any body that is not `application/json` (415), which is what
// keeps a "simple" cross-site form/text POST (no CORS preflight) from reaching a handler.

export const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export function errorResponse(e: unknown): Response {
  if (e instanceof FormatError) return json({ status: 400, message: e.message, problems: e.issues }, 400);
  if (e instanceof ApiError) {
    return json({ status: e.status, message: e.message, ...(e.problems ? { problems: e.problems } : {}) }, e.status);
  }
  console.error(e);
  return json({ status: 500, message: `unexpected IDE failure: ${(e as Error)?.message ?? String(e)}` }, 500);
}

/** Methods that never change state (no CSRF check; the host check still applies). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Host names the IDE answers to: it binds to the loopback interface only. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The host name of a `Host` header value (`name[:port]`, IPv6 in brackets), lower-case. */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const colon = h.lastIndexOf(':');
  return colon >= 0 ? h.slice(0, colon) : h;
}

/** The `host[:port]` the request was addressed to. */
function requestHost(request: Request): string {
  const header = request.headers.get('host');
  if (header) return header.trim().toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The request guard (403 on failure):
 * - the request's host must be a loopback name (`localhost`, `127.0.0.1`, `[::1]`): a page that
 *   rebinds its own domain to 127.0.0.1 is refused even though the browser deems it same-origin;
 * - a state-changing method (anything but GET/HEAD/OPTIONS) must be same-origin: a
 *   `Sec-Fetch-Site` header other than `same-origin` or `none` is refused, and so is an `Origin`
 *   header (including `null`) whose `host[:port]` is not the request's own. Clients that send
 *   neither header (the repo scripts, curl) are not browsers and cannot be driven cross-site.
 */
export function guardRequest(request: Request): void {
  const host = requestHost(request);
  if (!LOOPBACK_HOSTS.has(hostName(host))) throw new ApiError(403, 'the IDE only answers requests addressed to a loopback host');
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, `cross-origin request refused (Sec-Fetch-Site: ${site})`);
  }
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      const url = new URL(origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') originHost = url.host.toLowerCase();
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== host) throw new ApiError(403, 'cross-origin request refused (Origin does not match the IDE)');
  }
}

/** Applies the request guard, then runs the handler, mapping thrown errors to their JSON response. */
export async function handle(request: Request, fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    guardRequest(request);
    const out = await fn();
    return out instanceof Response ? out : json(out);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Whether a Content-Type header names `application/json` (parameters such as charset allowed). */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

/** Whether the request carries a body (a declared non-zero length or a chunked transfer). */
export function hasBody(request: Request): boolean {
  const length = request.headers.get('content-length');
  if (length !== null) return length.trim() !== '0';
  return request.headers.has('transfer-encoding');
}

/** The JSON body of a request: 415 unless it is `application/json`, 400 when it is not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    throw new ApiError(415, 'the request body must be application/json');
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'malformed JSON body');
  }
}
