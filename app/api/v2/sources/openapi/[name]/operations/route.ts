import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** `?project=&env=` -> `{specUrl, baseUrl, fetchedAt, operations}` from that environment's cache. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  return handle(async () => {
    const q = request.nextUrl.searchParams;
    return services().openApi.spec(q.get('project') ?? '', (await params).name, q.get('env'));
  });
}
