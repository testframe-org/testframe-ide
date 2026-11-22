// What an openapi source offers to its cards, distilled from its OpenAPI (or Swagger 2) document:
// the API base URL (servers[0].url resolved against the spec URL; the spec URL's origin when the
// document names no server) and the fixed list of operations. This is what the IDE caches per
// environment in .testframebuild/ (layout private to the IDE).

export interface Operation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
}

export interface OpenApiSpec {
  specUrl: string;
  /** The API base requests go to (`apiBase` in the runner protocol). */
  baseUrl: string;
  fetchedAt: string;
  operations: Operation[];
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (node: unknown, field: string): string => {
  const v = isMap(node) ? node[field] : undefined;
  return typeof v === 'string' ? v : '';
};

export class SpecError extends Error {}

/** Parses an OpenAPI (or Swagger 2) JSON document; SpecError when it is not one. */
export function parseSpec(specUrl: string, fetchedAt: string, document: string): OpenApiSpec {
  let root: unknown;
  try {
    root = JSON.parse(document ?? '');
  } catch (e) {
    throw new SpecError(`the spec at ${specUrl} is not JSON: ${(e as Error).message}`);
  }
  if (!isMap(root) || !isMap(root.paths)) throw new SpecError(`the document at ${specUrl} is not an OpenAPI spec (no "paths")`);
  const operations: Operation[] = [];
  for (const [p, item] of Object.entries(root.paths)) {
    if (!isMap(item)) continue;
    for (const [key, op] of Object.entries(item)) {
      const method = key.toUpperCase();
      if (METHODS.includes(method) && isMap(op)) {
        operations.push({ operationId: text(op, 'operationId'), method, path: p, summary: text(op, 'summary') });
      }
    }
  }
  return { specUrl, baseUrl: baseUrlOf(specUrl, root), fetchedAt, operations };
}

function baseUrlOf(specUrl: string, root: Record<string, unknown>): string {
  const spec = new URL(specUrl);
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const server = text(servers[0], 'url');
  if (!server) {
    const host = text(root, 'host'); // Swagger 2: host + basePath
    return host ? `${spec.protocol}//${host}${text(root, 'basePath')}` : spec.origin;
  }
  return new URL(server, spec).toString().replace(/\/+$/, '');
}

const normalize = (endpoint: string) => endpoint.trim().replace(/\s+/g, ' ');

export const endpointOf = (op: Operation): string => `${op.method} ${op.path}`;

/** Whether `endpoint` (`METHOD /path`) is one of the spec's operations. */
export const hasEndpoint = (spec: OpenApiSpec, endpoint: string): boolean =>
  spec.operations.some((o) => endpointOf(o).toLowerCase() === normalize(endpoint).toLowerCase());

/** The operation whose operationId is `operationId`. */
export const byId = (spec: OpenApiSpec, operationId: string | null | undefined): Operation | undefined =>
  !operationId || !operationId.trim() ? undefined : spec.operations.find((o) => o.operationId === operationId.trim());

/** Reads a cached spec (JSON); null when it is not one. */
export function fromCache(content: string | null): OpenApiSpec | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as OpenApiSpec;
    if (typeof v.specUrl !== 'string' || typeof v.baseUrl !== 'string' || !Array.isArray(v.operations)) return null;
    return v;
  } catch {
    return null;
  }
}

export const toCache = (spec: OpenApiSpec): string => `${JSON.stringify(spec, null, 2)}\n`;
