import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** `{environments, layers: {base, private, env: {E: {public, private}}}, errors}`; private-layer values come back as PRIVATE_MARKER. */
export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  return handle(request, async () => services().sources.view((await params).project));
}
