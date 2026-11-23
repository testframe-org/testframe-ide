import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { passThrough } from '@/lib/services/runner-client';

export const dynamic = 'force-dynamic';

/** `{project, environment, step, card, vars, payload, resultCard}`: runs one card through the plugin. */
export async function POST(request: Request) {
  return handle(request, async () => passThrough(await services().runs.runCard(await readJson(request))));
}
