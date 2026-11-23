import { handle, readJson } from '@/lib/api/http';
import { services } from '@/lib/services/context';
import type { CardRun } from '@/lib/format/types';

/** `{project, environment, frame, step, varName, result}`: stores a card's last run in .testframebuild/. */
export async function POST(request: Request) {
  return handle(request, async () => {
    const b = (await readJson(request)) as {
      project?: string; environment?: string; frame?: string; step?: number; varName?: string; result?: CardRun;
    };
    return services().frames.saveResult(b.project ?? '', b.environment, b.frame, b.step, b.varName, b.result);
  });
}
