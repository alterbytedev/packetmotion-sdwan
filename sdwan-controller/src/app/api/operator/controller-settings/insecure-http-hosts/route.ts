import { operatorRequest } from '@/lib/fabric/http';
import { FabricError } from '@/lib/fabric/authorization';
import { getInsecureHttpHosts, replaceInsecureHttpHosts } from '@/lib/fabric/insecure-http-allowlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return operatorRequest(request, false, async (actor) => {
    if (actor.role !== 'superadmin') throw new FabricError(403, 'Superadmin access required.');
    return { hosts: await getInsecureHttpHosts() };
  });
}

export function PUT(request: Request) {
  return operatorRequest(request, true, async (actor, input) => {
    if (actor.role !== 'superadmin') throw new FabricError(403, 'Superadmin access required.');
    return { hosts: await replaceInsecureHttpHosts(actor, input) };
  });
}
