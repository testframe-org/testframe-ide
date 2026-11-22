import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { passThrough } from '@/lib/services/runner-client';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

/** Forwards /api/tour/* verbatim (method, query, body, response stream) to the plugin's /api/v1/tour/*. */
async function forward(request: NextRequest, { params }: Context) {
  return handle(async () => {
    const { path } = await params;
    const target = `/api/v1/tour/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
    return passThrough(await services().runner.forward(request, target));
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
