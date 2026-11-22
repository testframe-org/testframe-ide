import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** `{frames, errors}`; `?env=` picks the environment of the cards' last runs and endpoint checks. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ project: string }> }) {
  return handle(async () => {
    const { project } = await params;
    return services().frames.load(project, request.nextUrl.searchParams.get('env'));
  });
}
