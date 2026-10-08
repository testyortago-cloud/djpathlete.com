import { createServiceRoleClient } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit/record"
import { verifyLoginCode } from "@/lib/db/login-codes"
import { sanitizePermissionMap } from "@/lib/permissions/registry"
import type { UserRole } from "@/types/database"

type UserRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  permissions: unknown
  password_hash: string | null
}

/** What authorize() hands NextAuth, whichever way the person proved who they are. */
export function toSessionUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: `${user.first_name} ${user.last_name}`,
    role: user.role,
    permissions: sanitizePermissionMap(user.permissions),
  }
}

/**
 * The "email-code" provider: email + the 6-digit code from
 * POST /api/auth/login-code. Only accounts that can already sign in with a
 * password may use it — a code is another way in, not a way to make an
 * account, so a contact-form lead still needs the coach's invite.
 */
export async function authorizeEmailCode(credentials: Partial<Record<string, unknown>> | undefined) {
  const email = typeof credentials?.email === "string" ? credentials.email.trim() : ""
  const code = typeof credentials?.code === "string" ? credentials.code.trim() : ""
  if (!email || !/^\d{6}$/.test(code)) return null

  const supabase = createServiceRoleClient()
  const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle()
  const failed = (reason: string, id: string | null = null) =>
    recordAudit({
      action: "auth.login_failed",
      category: "auth",
      outcome: "failure",
      actor: { id, email, role: "anonymous" },
      metadata: { method: "email_code", reason },
    })

  // A failed lookup is not "no such user": keep the audit trail honest.
  if (error) {
    await failed("lookup_failed")
    return null
  }
  if (!user) {
    await failed("user_not_found")
    return null
  }
  if (!user.password_hash) {
    await failed("lead_no_password", user.id)
    return null
  }

  const result = await verifyLoginCode(user.id, code)
  if (result !== "ok") {
    await failed(`code_${result}`, user.id)
    return null
  }

  await recordAudit({
    action: "auth.login_succeeded",
    category: "auth",
    outcome: "success",
    actor: { id: user.id, email: user.email, role: user.role },
    metadata: { method: "email_code" },
  })
  return toSessionUser(user as UserRow)
}
