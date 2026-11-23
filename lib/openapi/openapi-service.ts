import { ApiError } from '../format/errors';
import { type ResolvedSource, redact } from '../sources/sources-yaml';
import type { SourceService } from '../services/source-service';
import type { ProjectStore } from '../store/project-store';
import { type OpenApiSpec, SpecError, fromCache, parseSpec, toCache } from './openapi-spec';

/** Fetches a document by URL with headers (swapped by tests); throws with the reason. */
export type Fetcher = (url: string, headers: Record<string, string>) => Promise<string>;

/** `.testframebuild/openapi/{env}/{name}.json` (layout private to the IDE). */
export const cachePath = (env: string, name: string): string => `openapi/${env}/${name}.json`;

/**
 * The operations of an openapi source in one environment. The source's resolved base-url is its
 * OpenAPI spec URL (fetched with the source's resolved headers); the spec is distilled into a
 * per-environment cache keyed by the SHA-256 of the resolved spec URL, which the operations
 * endpoint, the run requests and the endpoint check on load read. A missing cache (or one made
 * from another spec URL) is fetched once; a spec that cannot be read is a 502. The spec URL may
 * be a secret: it is never written to the cache, returned, or left in an error message (the
 * source's secrets are redacted from every message).
 */
export class OpenApiService {
  constructor(
    private readonly store: ProjectStore,
    private readonly sources: SourceService,
    private readonly fetcher: Fetcher = httpFetcher
  ) {}

  /** GET .../operations: the cached spec as the browser may see it. */
  async spec(project: string, name: string, env: string | null | undefined): Promise<OpenApiSpec> {
    const source = await this.sources.resolveOne(project, 'openapi', name, env);
    return publicView(await this.specOf(project, source, env!), source);
  }

  /** The cached spec of a resolved source (fetched when missing or made from another URL). */
  async specOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec> {
    const cached = fromCache(await this.store.readBuild(project, cachePath(env, source.name)), source.baseUrl);
    return cached ?? this.refreshOf(project, source, env);
  }

  /** The cached spec only (no fetch): null when there is none for the current spec URL. */
  async cachedOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec | null> {
    return fromCache(await this.store.readBuild(project, cachePath(env, source.name)), source.baseUrl);
  }

  /** POST .../operations/refresh: fetches again; the answer is the browser's view. */
  async refresh(project: string, name: string, env: string | null | undefined): Promise<OpenApiSpec> {
    const source = await this.sources.resolveOne(project, 'openapi', name, env);
    return publicView(await this.refreshOf(project, source, env!), source);
  }

  /** Fetches the spec and rewrites the cache; a failure keeps the previous cache. */
  async refreshOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec> {
    const specUrl = source.baseUrl;
    // the URL is shown only when no layer made it a secret; any secret left in a message is redacted
    const where = source.privateFields.includes('base-url') ? `openapi/${source.name}` : specUrl;
    const fail = (message: string) => new ApiError(502, redact(`cannot read the OpenAPI spec of ${where}: ${message}`, source.secrets));
    let document: string;
    try {
      document = await this.fetcher(specUrl, source.headers);
    } catch (e) {
      throw fail(reason(e));
    }
    let spec: OpenApiSpec;
    try {
      spec = parseSpec(specUrl, new Date().toISOString(), document);
    } catch (e) {
      throw fail(e instanceof SpecError ? e.message : reason(e));
    }
    await this.store.writeBuild(project, cachePath(env, source.name), toCache(spec, specUrl));
    return spec;
  }
}

/** A spec as a route returns it: only the known fields, the source's secrets redacted from the API base. */
function publicView(spec: OpenApiSpec, source: ResolvedSource): OpenApiSpec {
  return { baseUrl: redact(spec.baseUrl, source.secrets), fetchedAt: spec.fetchedAt, operations: spec.operations };
}

/** The error text, with the network cause (ECONNREFUSED...) when fetch hides it. */
export function reason(e: unknown): string {
  const err = e as Error & { cause?: { message?: string; code?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause && !err.message.includes(cause) ? `${err.message} (${cause})` : err.message;
}

/**
 * The default fetcher. Redirects are refused (`redirect: 'error'`): the request carries the
 * source's resolved headers, private ones included, and a redirect must not forward them to
 * another host.
 */
export async function httpFetcher(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
