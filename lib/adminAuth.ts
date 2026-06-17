/**
 * Minimal write protection for the internal admin routes (v1.2).
 * NOT a real auth system — a single shared secret in `FOODSWIPE_ADMIN_SECRET`,
 * sent as the `x-foodswipe-admin-secret` header. Compared in constant time.
 */
const ADMIN_SECRET_HEADER = "x-foodswipe-admin-secret";

export function isAdminConfigured(): boolean {
  return Boolean(process.env.FOODSWIPE_ADMIN_SECRET);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function hasValidAdminSecret(req: Request): boolean {
  const expected = process.env.FOODSWIPE_ADMIN_SECRET;
  if (!expected) return false; // writes disabled unless a secret is configured
  const provided = req.headers.get(ADMIN_SECRET_HEADER) ?? "";
  return constantTimeEquals(provided, expected);
}
