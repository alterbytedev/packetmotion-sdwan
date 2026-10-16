import 'server-only';
import { isIP } from 'node:net';
import { isInsecureHttpHostAllowed } from './insecure-http-allowlist';

function configuredServerCaFingerprint() {
  const value = process.env.CONTROLLER_AGENT_CA_SHA256?.replaceAll(':', '').toUpperCase();
  return value && /^[A-F0-9]{64}$/.test(value) ? value : null;
}

export async function enrollmentTransport(request: Request) {
  const configured = process.env.CONTROLLER_ENROLLMENT_URL;
  const requestOrigin = request.headers.get('origin');
  let candidate = configured || requestOrigin;
  let insecureHttpBlocked = false;
  if (configured && requestOrigin) {
    try {
      const configuredUrl = new URL(configured);
      const requestUrl = new URL(requestOrigin);
      if (requestUrl.protocol === 'http:') {
        candidate = configuredUrl.hostname === requestUrl.hostname ? requestOrigin : null;
        insecureHttpBlocked = candidate === null;
      }
    } catch {
      // The normal origin validation below will reject malformed configuration.
    }
  }
  if (!candidate)
    return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked };
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
    const origin = url.origin;
    if (url.protocol === 'https:') {
      const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
      if (await isInsecureHttpHostAllowed(hostname))
        return {
          controllerUrl: `http://${url.hostname}`,
          allowInsecureHttp: true,
          insecureHttpBlocked: false,
          serverCaSha256: configuredServerCaFingerprint(),
        };
      return {
        controllerUrl: origin,
        allowInsecureHttp: false,
        insecureHttpBlocked: false,
        serverCaSha256: configuredServerCaFingerprint(),
      };
    }
    if (url.protocol !== 'http:')
      return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked: false };
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    const loopback = hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'));
    const allowed = loopback || (url.protocol === 'http:' && await isInsecureHttpHostAllowed(hostname));
    return {
      controllerUrl: allowed ? origin : null,
      allowInsecureHttp: allowed,
      insecureHttpBlocked: url.protocol === 'http:' && !allowed,
      serverCaSha256: allowed ? configuredServerCaFingerprint() : null,
    };
  } catch {
    return { controllerUrl: null, allowInsecureHttp: false, insecureHttpBlocked };
  }
}
