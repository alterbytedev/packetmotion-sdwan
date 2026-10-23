import { operatorRequest } from '@/lib/fabric/http';
import { deployWireguardDraft } from '@/lib/fabric/wireguard-drafts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, (actor, input) => deployWireguardDraft(actor, id, input));
}
