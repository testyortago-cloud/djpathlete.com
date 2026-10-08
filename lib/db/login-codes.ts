import { createServiceRoleClient } from "@/lib/supabase"
import { randomInt } from "crypto"
import { compare, hash } from "bcryptjs"

// Six-digit codes emailed from /login, a way in for people who have lost
// track of their password. The digits are short, so the safety is in the
// limits: hashed at rest, 10 minutes to live, 5 tries, one use, newest only.
export const LOGIN_CODE_TTL_MINUTES = 10
export const LOGIN_CODE_MAX_ATTEMPTS = 5
export const LOGIN_CODE_COOLDOWN_SECONDS = 60
export const LOGIN_CODE_MAX_PER_HOUR = 5
// Caps a slow attacker at 50 guesses a day (10 codes x 5 tries), about 2% a
// year against a million codes, and every code they burn emails the owner.
export const LOGIN_CODE_MAX_PER_DAY = 10

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

export type IssueLoginCodeResult = { status: "issued"; code: string } | { status: "cooldown" | "rate_limited" }
export type VerifyLoginCodeResult = "ok" | "no_code" | "used" | "expired" | "locked" | "wrong"

function getClient() {
  return createServiceRoleClient()
}

export async function issueLoginCode(userId: string): Promise<IssueLoginCodeResult> {
  const supabase = getClient()
  const now = Date.now()

  const { data: recent, error } = await supabase
    .from("login_codes")
    .select("created_at, used_at, attempts")
    .eq("user_id", userId)
    .gte("created_at", new Date(now - DAY_MS).toISOString())
    .order("created_at", { ascending: false })
  if (error) throw error

  // A second tap inside the cooldown keeps the code already in the inbox
  // alive instead of replacing it with one the person has not opened. A code
  // that is spent or locked has nothing left to protect, so it holds nothing back.
  const latest = recent[0]
  if (
    latest &&
    !latest.used_at &&
    latest.attempts < LOGIN_CODE_MAX_ATTEMPTS &&
    now - Date.parse(latest.created_at) < LOGIN_CODE_COOLDOWN_SECONDS * 1000
  ) {
    return { status: "cooldown" }
  }
  const lastHour = recent.filter((r) => now - Date.parse(r.created_at) < HOUR_MS).length
  if (lastHour >= LOGIN_CODE_MAX_PER_HOUR || recent.length >= LOGIN_CODE_MAX_PER_DAY) {
    return { status: "rate_limited" }
  }

  // Housekeeping: nothing older than a day can matter to either limit.
  await supabase
    .from("login_codes")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", new Date(now - DAY_MS).toISOString())

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0")
  const { error: insertError } = await supabase.from("login_codes").insert({
    user_id: userId,
    code_hash: await hash(code, 10),
    expires_at: new Date(now + LOGIN_CODE_TTL_MINUTES * 60_000).toISOString(),
  })
  if (insertError) throw insertError

  return { status: "issued", code }
}

export async function verifyLoginCode(userId: string, code: string): Promise<VerifyLoginCodeResult> {
  const supabase = getClient()

  // Only the newest code counts, used or not, so an older unused code cannot
  // come back to life once a later one has been sent or spent.
  const { data: row, error } = await supabase
    .from("login_codes")
    .select("id, code_hash, expires_at, attempts, used_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!row) return "no_code"
  if (row.used_at) return "used"
  if (Date.parse(row.expires_at) <= Date.now()) return "expired"
  if (row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) return "locked"

  // Claim a try BEFORE comparing. The update only lands if nobody else
  // claimed this try first, so parallel guesses cannot share one.
  const { data: claimed, error: claimError } = await supabase
    .from("login_codes")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("id")
  if (claimError) throw claimError
  if (!claimed || claimed.length === 0) return "wrong"

  if (!(await compare(code, row.code_hash))) return "wrong"

  const { data: spent, error: spendError } = await supabase
    .from("login_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
  if (spendError) throw spendError
  return spent && spent.length > 0 ? "ok" : "used"
}
