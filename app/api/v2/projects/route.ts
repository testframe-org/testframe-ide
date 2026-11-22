import { handle } from '@/lib/api/http';
import { countSources, services } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** Projects under the projects root (folders with testframe/), most recently changed first. */
export async function GET() {
  return handle(async () => {
    const s = services();
    return s.store.listProjects((project) => countSources(s, project));
  });
}
