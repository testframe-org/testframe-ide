import { ApiError } from '../format/errors';
import { hasBody, isJsonContentType } from './http';

// The IDE's /api/tour/* proxy (docs/test-tour.md): the request is forwarded to the plugin's
// /api/v1/tour/*, with the plugin token added server-side. The target path is built from
// request-supplied segments, so it is validated here before anything is forwarded: a segment
// that is empty, `.` or `..` (in any encoding) would let the request climb out of /api/v1/tour
// and reach another token-bearing plugin route (e.g. /api/v1/run).

export const TOUR_PREFIX = '/api/v1/tour';

/**
 * The tour API's path segments are project, frame and run-id names, plus fixed words
 * (docs/test-tour.md, "Tour API"): `[A-Za-z0-9._-]+`. Anything else is refused.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_SEGMENTS = 8;
const MAX_SEGMENT_LENGTH = 255;

/** Decodes a segment until it is stable (so `%252e%252e` is checked as `..` too). */
function fullyDecoded(segment: string): string {
  let current = segment;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      throw new ApiError(400, 'invalid tour path: malformed percent-encoding');
    }
    if (next === current) return current;
    current = next;
  }
  throw new ApiError(400, 'invalid tour path: over-encoded segment');
}

/**
 * The plugin path for a /api/tour/{...segments}?{search} request: 400 unless every segment is a
 * plain name (after decoding) — never empty, `.`, `..`, or holding a separator.
 */
export function tourTarget(segments: readonly string[], search: string): string {
  if (!segments.length || segments.length > MAX_SEGMENTS) throw new ApiError(400, 'invalid tour path');
  const clean = segments.map((segment) => {
    const decoded = fullyDecoded(segment);
    if (decoded === '' || decoded === '.' || decoded === '..' || decoded.length > MAX_SEGMENT_LENGTH || !SEGMENT.test(decoded)) {
      throw new ApiError(400, 'invalid tour path: segments are names ([A-Za-z0-9._-]+), never "", "." or ".."');
    }
    return decoded;
  });
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `${TOUR_PREFIX}/${clean.join('/')}${query}`;
}

/** A state-changing tour request with a body must send JSON (415 otherwise). */
export function checkTourBody(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
  if (hasBody(request) && !isJsonContentType(request.headers.get('content-type'))) {
    throw new ApiError(415, 'the request body must be application/json');
  }
}
