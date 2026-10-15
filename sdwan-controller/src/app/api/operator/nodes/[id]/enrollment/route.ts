import { operatorRequest } from '@/lib/fabric/http';
import { reissueEnrollment } from '@/lib/fabric/enrollment';
import { enrollmentTransport } from '@/lib/fabric/enrollment-instructions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operatorRequest(request, true, async (actor) => {
    const transport = await enrollmentTransport(request);
    return { ...(await reissueEnrollment(actor, id)), ...transport };
  });
}
