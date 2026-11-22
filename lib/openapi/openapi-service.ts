import { ApiError } from '../format/errors';
import type { ResolvedSource } from '../sources/sources-yaml';
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
 * per-environment cache keyed by the resolved spec URL, which the operations endpoint, the run
 * requests and the endpoint check on load read. A missing cache (or one made from another spec
 * URL) is fetched once; a spec that cannot be read is a 502.
 */
export class OpenApiService {
  constructor(
    private readonly store: ProjectStore,
    private readonly sources: SourceService,
    private readonly fetcher: Fetcher = httpFetcher
  ) {}

  async spec(project: string, name: string, env: string | null | undefined): Promise<OpenApiSpec> {
    const source = await this.sources.resolveOne(project, 'openapi', name, env);
    return this.specOf(project, source, env!);
  }

  /** The cached spec of a resolved source (fetched when missing or made from another URL). */
  async specOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec> {
    const cached = fromCache(await this.store.readBuild(project, cachePath(env, source.name)));
    if (cached && cached.specUrl === source.baseUrl) return cached;
    return this.refreshOf(project, source, env);
  }

  /** The cached spec only (no fetch): null when there is none for the current spec URL. */
  async cachedOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec | null> {
    const cached = fromCache(await this.store.readBuild(project, cachePath(env, source.name)));
    return cached && cached.specUrl === source.baseUrl ? cached : null;
  }

  async refresh(project: string, name: string, env: string | null | undefined): Promise<OpenApiSpec> {
    const source = await this.sources.resolveOne(project, 'openapi', name, env);
    return this.refreshOf(project, source, env!);
  }

  /** Fetches the spec and rewrites the cache; a failure keeps the previous cache. */
  async refreshOf(project: string, source: ResolvedSource, env: string): Promise<OpenApiSpec> {
    const specUrl = source.baseUrl;
    let document: string;
    try {
      document = await this.fetcher(specUrl, source.headers);
    } catch (e) {
      throw new ApiError(502, `cannot read the OpenAPI spec at ${specUrl}: ${reason(e)}`);
    }
    let spec: OpenApiSpec;
    try {
      spec = parseSpec(specUrl, new Date().toISOString(), document);
    } catch (e) {
      if (e instanceof SpecError) throw new ApiError(502, e.message);
      throw e;
    }
    await this.store.writeBuild(project, cachePath(env, source.name), toCache(spec));
    return spec;
  }
}

/** The error text, with the network cause (ECONNREFUSED...) when fetch hides it. */
export function reason(e: unknown): string {
  const err = e as Error & { cause?: { message?: string; code?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause && !err.message.includes(cause) ? `${err.message} (${cause})` : err.message;
}

async function httpFetcher(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
