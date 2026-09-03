/**
 * One definition, so the reader (resolveAdminTenant) and the writer (the
 * switcher's server action) cannot disagree about the name or the flags.
 *
 * This cookie is a PREFERENCE, never an authorisation. resolveAdminTenant
 * honours it only if its value is in the caller's server-recomputed allowed
 * set, which is what stops a forged header being a cross-tenant read.
 */
export const BUSINESS_COOKIE = "djp_business"

export const businessCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
}
