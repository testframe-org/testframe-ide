import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** The IDE is up; `runner` tells whether runs can go through the plugin. */
export async function GET(request: Request) {
  return handle(request, async () => ({ status: 'UP', service: 'testframe-ide', runner: await services().runner.health() }));
}
