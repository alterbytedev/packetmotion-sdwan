export const OPERATOR_ROLES = ['superadmin', 'admin', 'viewer'];

export function isOperatorEmail(value) {
  return typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s@]+@(?:localhost|[^\s@]+\.[^\s@]+)$/.test(value);
}
