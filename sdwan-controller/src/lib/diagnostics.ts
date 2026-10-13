import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '@/lib/db';

export function createRequestId() {
  return randomUUID();
}

const sensitiveValue =
  /\b(password|passwd|secret|token|authorization|cookie|api[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const errorCleanup = globalThis as typeof globalThis & { sdwanErrorCleanupAt?: number };

function clean(value: string, limit: number) {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[PRIVATE KEY REDACTED]',
    )
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[DATABASE_URL]')
    .replace(/([?&](?:token|secret|password|key|code)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(sensitiveValue, '$1$2[REDACTED]')
    .slice(0, limit);
}

function errorProperty(error: unknown, key: string) {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export async function reportServerError(
  scope: string,
  requestId: string,
  error: unknown,
  context: { routePath?: string; method?: string } = {},
) {
  const candidateName = errorProperty(error, 'name') || 'UnknownError';
  const name = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidateName) ? candidateName : 'UnknownError';
  const rawCode = errorProperty(error, 'code');
  const code = rawCode && /^[A-Z0-9_]{1,32}$/.test(rawCode) ? rawCode : null;
  const message = clean(errorProperty(error, 'message') || 'An unexpected error occurred.', 2000);
  const stack = clean(errorProperty(error, 'stack') || '', 12000) || null;
  const routePath = context.routePath ? clean(context.routePath, 300) : null;
  const method = context.method && /^[A-Z]{1,12}$/.test(context.method) ? context.method : null;
  try {
    if (
      !errorCleanup.sdwanErrorCleanupAt ||
      Date.now() - errorCleanup.sdwanErrorCleanupAt > 86_400_000
    ) {
      errorCleanup.sdwanErrorCleanupAt = Date.now();
      try {
        await getDatabase().query(
          "DELETE FROM runtime_errors WHERE last_seen_at < now() - interval '30 days'",
        );
      } catch {
        // Retention cleanup is best effort; still persist the current incident.
      }
    }
    await getDatabase().query(
      `INSERT INTO runtime_errors
        (reference_id,source,route_path,method,error_name,error_code,message,stack)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (reference_id) DO UPDATE SET
         last_seen_at=now(), occurrence_count=runtime_errors.occurrence_count+1,
         source=EXCLUDED.source, route_path=EXCLUDED.route_path, method=EXCLUDED.method,
         error_name=EXCLUDED.error_name, error_code=EXCLUDED.error_code,
         message=EXCLUDED.message, stack=EXCLUDED.stack`,
      [requestId, scope, routePath, method, name, code, message, stack],
    );
    console.error(
      JSON.stringify({
        event: 'controller.request_failed',
        scope,
        requestId,
        errorName: name,
        ...(code ? { errorCode: code } : {}),
      }),
    );
  } catch (loggingError) {
    const loggingCode = errorProperty(loggingError, 'code');
    console.error(
      JSON.stringify({
        event: 'controller.error_log_persist_failed',
        scope,
        requestId,
        errorName: name,
        ...(code ? { errorCode: code } : {}),
        loggingErrorCode:
          loggingCode && /^[A-Z0-9_]{1,32}$/.test(loggingCode) ? loggingCode : undefined,
      }),
    );
  }
}
