import { ApiError } from '../format/errors';
import { reason } from '../openapi/openapi-service';

// The IDE's client of the runner plugin (docs/runner-protocol.md, /api/v1). The plugin URL comes
// from TESTFRAME_RUNNER_URL (and its token, when one is configured, from TESTFRAME_RUNNER_TOKEN);
// the IDE calls it server-side only. Editing never needs the plugin: when it is down, not
// configured or speaks another protocol, run requests answer 503 with the reason.

export const PROTOCOL = 1;

export interface RunnerHealth {
  status: 'up' | 'down' | 'incompatible' | 'unconfigured';
  url: string | null;
  name?: string;
  version?: string;
  protocol?: number;
  capabilities?: unknown;
  message?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const HEALTH_TTL_MS = 5000;

export class RunnerClient {
  private cached: { at: number; health: RunnerHealth } | null = null;

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private url(path: string): string {
    return `${this.baseUrl!.replace(/\/+$/, '')}${path}`;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** GET /api/v1/health, cached for a few seconds. */
  async health(force = false): Promise<RunnerHealth> {
    if (!this.baseUrl) {
      return { status: 'unconfigured', url: null, message: 'TESTFRAME_RUNNER_URL is not set: the IDE has no runner plugin to run cards with' };
    }
    if (!force && this.cached && Date.now() - this.cached.at < HEALTH_TTL_MS) return this.cached.health;
    let health: RunnerHealth;
    try {
      const res = await this.fetchImpl(this.url('/api/v1/health'), { headers: this.authHeaders(), signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { name?: string; version?: string; protocol?: number; capabilities?: unknown };
      health = {
        status: body.protocol === PROTOCOL ? 'up' : 'incompatible',
        url: this.baseUrl,
        name: body.name,
        version: body.version,
        protocol: body.protocol,
        capabilities: body.capabilities,
        message: body.protocol === PROTOCOL ? undefined : `plugin protocol ${body.protocol}, IDE expects ${PROTOCOL}`
      };
    } catch (e) {
      health = { status: 'down', url: this.baseUrl, message: `the runner plugin is not reachable at ${this.baseUrl}: ${reason(e)}` };
    }
    this.cached = { at: Date.now(), health };
    return health;
  }

  /** Throws 503 unless the plugin is up and speaks the IDE's protocol. */
  async requireUp(): Promise<void> {
    const health = await this.health();
    if (health.status !== 'up') {
      throw new ApiError(503, `${health.message ?? 'the runner plugin is unavailable'} (editing still works; start the plugin to run cards)`);
    }
  }

  /** POST a JSON body to the plugin; the response (stream included) is returned as is. */
  async post(path: string, body: unknown, accept: string, timeoutMs: number): Promise<Response> {
    await this.requireUp();
    try {
      return await this.fetchImpl(this.url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: accept, ...this.authHeaders() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      this.cached = null;
      throw new ApiError(503, `the runner plugin did not answer at ${this.baseUrl}: ${reason(e)}`);
    }
  }

  /** Forwards a request verbatim to the plugin path (method, query, body, response stream). */
  async forward(request: Request, pluginPath: string): Promise<Response> {
    if (!this.baseUrl) throw new ApiError(503, 'TESTFRAME_RUNNER_URL is not set: the tour runs in the runner plugin');
    const headers = new Headers();
    for (const name of ['content-type', 'accept', 'accept-language']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    for (const [k, v] of Object.entries(this.authHeaders())) headers.set(k, v);
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    try {
      return await this.fetchImpl(this.url(pluginPath), {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        signal: request.signal,
        ...(hasBody ? { duplex: 'half' } : {})
      } as RequestInit);
    } catch (e) {
      throw new ApiError(503, `the runner plugin is not reachable at ${this.baseUrl}: ${reason(e)}`);
    }
  }
}

/** A plugin response passed through to the browser (status, content type and body stream). */
export function passThrough(upstream: Response): Response {
  const headers = new Headers();
  const type = upstream.headers.get('content-type');
  if (type) headers.set('content-type', type);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers.set('content-disposition', disposition);
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
