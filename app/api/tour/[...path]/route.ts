import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api/http';
import { checkTourBody, tourTarget } from '@/lib/api/tour-proxy';
import { services } from '@/lib/services/context';
import { passThrough } from '@/lib/services/runner-client';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

/**
 * Forwards /api/tour/* (method, query, body, response stream) to the plugin's /api/v1/tour/*.
 * The path is validated first (lib/api/tour-proxy): it can never leave /api/v1/tour.
 */
async function forward(request: NextRequest, { params }: Context) {
  return handle(request, async () => {
    const { path } = await params;
    const target = tourTarget(path, request.nextUrl.search);
    checkTourBody(request);
    return passThrough(await services().runner.forward(request, target));
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
