import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import { NDJSON } from '@/lib/services/run-service';
import { passThrough } from '@/lib/services/runner-client';

export const dynamic = 'force-dynamic';

/**
 * `{project, frame, environment, steps: [{number, cards}]}`: runs the frame through the plugin.
 * `Accept: application/x-ndjson` streams the run events through; otherwise one JSON answer.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const accept = (request.headers.get('accept') ?? '').includes(NDJSON) ? NDJSON : 'application/json';
    return passThrough(await services().runs.runFrame(await readJson(request), accept));
  });
}
