import { operatorRequest } from '@/lib/fabric/http';
import { createNode, listDevices } from '@/lib/fabric/inventory';
import { enrollmentTransport } from '@/lib/fabric/enrollment-instructions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return operatorRequest(request, false, async (actor) =>
    listDevices(actor, new URL(request.url).searchParams),
  );
}
export function POST(request: Request) {
  return operatorRequest(request, true, async (actor, input) => {
    const transport = await enrollmentTransport(request);
    const { enrollment, ...node } = await createNode(actor, input);
    return {
      node,
      enrollment: { ...enrollment, ...transport },
    };
  });
}
