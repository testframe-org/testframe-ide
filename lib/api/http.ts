import { ApiError, FormatError } from '../format/errors';

// Route handler helpers: every failure answers `{status, message}` (plus `problems` when there
// is a list), so the editor can show the reason.

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

/** Runs a handler, mapping thrown errors to their JSON response. */
export async function handle(fn: () => Promise<Response | unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : json(out);
  } catch (e) {
    return errorResponse(e);
  }
}

/** The JSON body of a request (400 when it is not JSON). */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'malformed JSON body');
  }
}
