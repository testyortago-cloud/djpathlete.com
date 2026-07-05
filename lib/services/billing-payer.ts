import { getBillingPayer } from "@/lib/db/client-billing-payers"

/**
 * The user whose Stripe customer + card actually pays for this client's
 * AUTOMATIC charges (no-show/late-cancel fees, memberships). Returns the payer
 * when one is set, else the client themselves. ONE HOP only — a payer's own
 * payer is ignored — so there are no chains and (with the DB self-check) no
 * loops. This is the single place the payer indirection lives.
 */
export async function resolveBillingUserId(clientUserId: string): Promise<string> {
  try {
    const link = await getBillingPayer(clientUserId)
    return link?.payer_user_id ?? clientUserId
  } catch (err) {
    // Fail safe to self-pay: a lookup error (e.g. the table not yet migrated, or a
    // transient DB blip) must never strand a reserved fee as `pending` or 500 a
    // membership checkout. Worst case the trainee is billed (usually cardless →
    // waived) instead of the payer, for that one attempt.
    console.error("[resolveBillingUserId] lookup failed, defaulting to self-pay:", err)
    return clientUserId
  }
}
