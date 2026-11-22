import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import type { Frame } from '@/lib/format/types';

/** `{project, frame: {name, steps}}`: replaces frames/{slug(name)}/ (400 with every problem). */
export async function POST(request: Request) {
  return handle(async () => {
    const body = (await readJson(request)) as { project?: string; frame?: Frame };
    return services().frames.save(body.project ?? '', body.frame);
  });
}
