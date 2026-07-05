import { getBillingPayer } from "@/lib/db/client-billing-payers"

/**
 * The user whose Stripe customer + card actually pays for this client's
 * AUTOMATIC charges (no-show/late-cancel fees, memberships). Returns the payer
 * when one is set, else the client themselves. ONE HOP only — a payer's own
 * payer is ignored — so there are no chains and (with the DB self-check) no
 * loops. This is the single place the payer indirection lives.
 */
export async function resolveBillingUserId(clientUserId: string): Promise<string> {
  const link = await getBillingPayer(clientUserId)
  return link?.payer_user_id ?? clientUserId
}
