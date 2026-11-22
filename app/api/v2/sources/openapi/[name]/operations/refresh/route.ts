import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

/** `?project=&env=`: fetches the spec again and rewrites that environment's cache. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  return handle(async () => {
    const q = request.nextUrl.searchParams;
    return services().openApi.refresh(q.get('project') ?? '', (await params).name, q.get('env'));
  });
}
