import { handle } from '@/lib/api/http';
import { services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** The runner plugin's health as the IDE sees it (checked now, not cached). */
export async function GET(request: Request) {
  return handle(request, () => services().runner.health(true));
}
