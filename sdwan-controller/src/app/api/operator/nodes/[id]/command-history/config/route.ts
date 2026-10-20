import { operatorRequest } from '@/lib/fabric/http';
import { readCommandConfig } from '@/lib/fabric/command-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const operationId = new URL(request.url).searchParams.get('operationId') || '';
  return operatorRequest(request, false, async (actor) =>
    readCommandConfig(actor, id, operationId),
  );
}
