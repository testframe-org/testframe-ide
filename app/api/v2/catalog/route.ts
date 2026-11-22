import { catalog } from '@/lib/api/domain';
import { handle } from '@/lib/api/http';

/** The source types with their subtypes (card type, fence, form, defaults, mongo signature) and the HTTP methods. */
export async function GET() {
  return handle(async () => catalog());
}
