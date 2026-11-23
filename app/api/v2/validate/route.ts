import { validate } from '@/lib/api/domain';
import { handle, readJson } from '@/lib/api/http';

/** `{sourceType, subtype, code}` -> `{problem, problems, formatted}` (the code rule). */
export async function POST(request: Request) {
  return handle(request, async () => validate(await readJson(request)));
}
