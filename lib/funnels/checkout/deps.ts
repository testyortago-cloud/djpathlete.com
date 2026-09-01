// lib/funnels/checkout/deps.ts — the real database, email and grant calls that
// `grantFunnelPurchase` takes as arguments.
//
// EVERY RULE LIVES IN grant.ts AND grant-program.ts, WHICH TAKE PORTS. This
// file is the only place those ports are bound to real infrastructure, and it
// deliberately contains no decisions — if you find yourself writing an `if`
// here about what SHOULD happen, it belongs in one of the two modules above,
// where it can be tested without a database.

import { createServiceRoleClient } from "@/lib/supabase"
import { assignProgram } from "@/lib/services/assign-program"
import { getAssignmentByUserAndProgram, updateAssignment } from "@/lib/db/assignments"
import { createPasswordResetToken } from "@/lib/db/password-reset-tokens"
import { sendLeadInviteEmail, sendFunnelPurchaseFailureAlert } from "@/lib/email"
import { getBaseUrl } from "@/lib/url"
import { hasProcessedCheckoutSession, recordCheckoutGrant } from "@/lib/db/funnel-checkout-grants"
import { grantProgramAccess } from "@/lib/funnels/checkout/grant-program"
import type { GrantDeps } from "@/lib/funnels/checkout/grant"

/** A week, matching the admin "send invite" flow rather than inventing a number. */
const SET_PASSWORD_TOKEN_HOURS = 24 * 7

export function buildGrantDeps(context: {
  funnelId: string | null
  stepId: string | null
  leadId: string | null
}): GrantDeps {
  return {
    /**
     * `hasPassword` decides whether a "set your password" email is owed, so
     * reading it wrong in either direction is a real fault: false-negative
     * spams a breach-shaped email at someone who has a password, false-positive
     * leaves a new buyer with no way in. It is derived from `password_hash`
     * being present, which is the same thing NextAuth's Credentials provider
     * checks when it decides whether the account can log in at all.
     *
     * A funnel buyer usually ALREADY has a row here, because the capture form
     * writes a `status: "lead"` user before checkout starts. That is the
     * find-before-create case working as intended, not an edge case.
     */
    findClientByEmail: async (email) => {
      const supabase = createServiceRoleClient()
      const { data, error } = await supabase
        .from("users")
        .select("id, password_hash")
        .ilike("email", email)
        .maybeSingle()
      if (error) throw new Error(`user lookup failed: ${error.message}`)
      if (!data) return null
      const row = data as { id: string; password_hash: string | null }
      return { id: row.id, hasPassword: Boolean(row.password_hash) }
    },

    /**
     * The same shape `/api/funnels/submit` writes for a lead, so a buyer who
     * never filled a capture form still lands in the Clients list looking like
     * every other inbound lead rather than like a special case.
     */
    createClient: async ({ email, name }) => {
      const supabase = createServiceRoleClient()
      const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
      const { data, error } = await supabase
        .from("users")
        .insert({
          email,
          first_name: parts[0] ?? email.split("@")[0],
          last_name: parts.slice(1).join(" "),
          role: "client",
          status: "lead",
          email_verified: false,
        })
        .select("id")
        .single()
      if (error) throw new Error(`client creation failed: ${error.message}`)
      return { id: (data as { id: string }).id }
    },

    /**
     * Through `grantProgramAccess`, which wraps the canonical `assignProgram`
     * with the two things a just-paid purchase needs and `assignProgram` cannot
     * express on its own: `prepaid`, and promoting a coach-created assignment
     * that was left awaiting payment. See that file's header.
     */
    assignProgram: (input) =>
      grantProgramAccess(input, {
        assignProgram: async (args) => {
          const result = await assignProgram(args)
          return { skipped: result.skipped }
        },
        getAssignmentByUserAndProgram: async (userId, programId) => {
          const row = await getAssignmentByUserAndProgram(userId, programId)
          return row ? { id: row.id, status: row.status, payment_status: row.payment_status } : null
        },
        markAssignmentPaid: async (assignmentId) => {
          await updateAssignment(assignmentId, { payment_status: "paid" })
        },
        today: () => new Date().toISOString().split("T")[0],
      }),

    hasProcessed: hasProcessedCheckoutSession,

    recordProcessed: async ({ idempotencyKey, userId, purchase, accountCreated }) => {
      await recordCheckoutGrant({
        stripe_session_id: idempotencyKey,
        user_id: userId,
        email: purchase.email,
        product_kind: purchase.productKind,
        product_id: purchase.productId,
        funnel_id: context.funnelId,
        step_id: context.stepId,
        lead_id: context.leadId,
        account_created: accountCreated,
      })
    },

    /**
     * The existing invite flow, reused whole: a password-reset token and the
     * same `/reset-password?token=` screen the admin "send invite" button uses.
     * A second, funnel-specific way to set a password would be a second thing
     * to keep secure.
     */
    sendSetPasswordEmail: async ({ userId, email, name }) => {
      const token = await createPasswordResetToken(userId, SET_PASSWORD_TOKEN_HOURS)
      const firstName = (name ?? "").trim().split(/\s+/)[0] || "there"
      await sendLeadInviteEmail(email, `${getBaseUrl()}/reset-password?token=${token}`, firstName)
    },

    alertFailure: async ({ purchase, stage, error }) => {
      await sendFunnelPurchaseFailureAlert({
        stripeSessionId: purchase.idempotencyKey,
        buyerEmail: purchase.email,
        buyerName: purchase.name,
        productKind: purchase.productKind,
        productId: purchase.productId,
        stage,
        error,
      })
    },
  }
}
