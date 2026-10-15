import 'server-only';
import { isIP } from 'node:net';
import { isInsecureHttpHostAllowed } from './insecure-http-allowlist';

export async function enrollmentTransport(request: Request) {
  const candidate = process.env.CONTROLLER_ENROLLMENT_URL || request.headers.get('origin');
  if (!candidate) return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
    const origin = url.origin;
    if (url.protocol === 'https:')
      return { controllerUrl: origin, allowInsecureHttp: false, insecureHttpBlocked: false };
    if (url.protocol !== 'http:')
      return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    const loopback = hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'));
    const allowed = loopback || (url.protocol === 'http:' && await isInsecureHttpHostAllowed(hostname));
    return {
      controllerUrl: allowed ? origin : null,
      allowInsecureHttp: allowed,
      insecureHttpBlocked: url.protocol === 'http:' && !allowed,
    };
  } catch {
    return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
  }
}
