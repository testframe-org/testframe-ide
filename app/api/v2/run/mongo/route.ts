import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { passThrough } from '@/lib/services/runner-client';

export const dynamic = 'force-dynamic';

/** `{project, environment, source, subtype, collection, body}`: one mongo call (body = the argument array). */
export async function POST(request: Request) {
  return handle(request, async () => passThrough(await services().runs.runMongo(await readJson(request))));
}
