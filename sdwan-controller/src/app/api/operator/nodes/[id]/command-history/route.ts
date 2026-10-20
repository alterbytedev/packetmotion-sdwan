import { operatorRequest } from '@/lib/fabric/http';
import { listCommandHistory } from '@/lib/fabric/command-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, false, async (actor) =>
    listCommandHistory(actor, id, new URL(request.url).searchParams),
  );
}
