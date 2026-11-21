export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body ? `${res.status} ${body.slice(0, 160)}` : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// JSON request helper for same-origin calls (Vite proxy -> testframe server)
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  if (!res.ok) throw new ApiError(res.status, await errorText(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
