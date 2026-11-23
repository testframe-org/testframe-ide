// Same-origin HTTP helpers: the editor only ever calls this module's own route handlers
// (app/api/v2/*), so there is no base URL, no CORS and no token in the browser.

/** A `{status, message, problems?}` answer of the IDE API (lib/api/http.ts). */
export class ApiError extends Error {
  readonly status: number;
  /** The server's `message`, without the status prefix. */
  readonly reason: string;
  /** Every problem the server listed (a rejected save lists all of them). */
  readonly problems: string[];

  constructor(status: number, message: string, reason = message, problems: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.problems = problems;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    return new ApiError(res.status, `HTTP ${res.status}`);
  }
  try {
    const parsed = JSON.parse(body) as { message?: unknown; problems?: unknown };
    if (typeof parsed.message === 'string') {
      const problems = Array.isArray(parsed.problems) ? parsed.problems.filter((p): p is string => typeof p === 'string') : [];
      return new ApiError(res.status, `${res.status} ${parsed.message}`, parsed.message, problems);
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, body ? `${res.status} ${body.slice(0, 200)}` : `HTTP ${res.status}`, body);
}

/** One JSON request; a non-2xx answer throws an ApiError carrying the server's reason. */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch (e) {
    throw new ApiError(0, `the IDE did not answer: ${(e as Error).message}`);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** The error text to show: the server's reason when there is one, else the message. */
export const reasonOf = (e: unknown): string => (e instanceof ApiError && e.reason ? e.reason : (e as Error).message);

/** Every problem of a rejected request (the reason alone when the server listed none). */
export const problemsOf = (e: unknown): string[] =>
  e instanceof ApiError && e.problems.length ? e.problems : [reasonOf(e)];
