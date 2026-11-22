import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** `{environments, layers: {base, private, env: {E: {public, private}}}, errors}`. */
export async function GET(_request: Request, { params }: { params: Promise<{ project: string }> }) {
  return handle(async () => services().sources.load((await params).project));
}
