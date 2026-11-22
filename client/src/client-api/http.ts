export class ApiError extends Error {
  status: number;
  reason: string; // the server's `message` for {status, message} error bodies, else the raw text

  constructor(status: number, message: string, reason = message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

// Framework errors are {status, message}: the message is shown in full; other bodies are cut
async function toApiError(res: Response): Promise<ApiError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    return new ApiError(res.status, `HTTP ${res.status}`);
  }
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') return new ApiError(res.status, `${res.status} ${parsed.message}`, parsed.message);
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, body ? `${res.status} ${body.slice(0, 160)}` : `HTTP ${res.status}`, body);
}

// JSON request helper for same-origin calls (Vite proxy -> testframe server)
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
