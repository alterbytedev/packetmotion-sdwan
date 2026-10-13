import { operatorRequest } from '@/lib/fabric/http';
import { createSite, listInventory } from '@/lib/fabric/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return operatorRequest(request, false, async (actor) => ({
    sites: (await listInventory(actor)).sites,
  }));
}
export function POST(request: Request) {
  return operatorRequest(request, true, async (actor, input) => ({
    site: await createSite(actor, input),
  }));
}
