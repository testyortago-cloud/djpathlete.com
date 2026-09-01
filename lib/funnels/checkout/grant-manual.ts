// lib/funnels/checkout/grant-manual.ts — handing an athlete their account when
// a coach marks a deal Won.
//
// THIS FILE CONTAINS NO GRANT LOGIC, AND THAT IS THE POINT. Finding or creating
// the client, assigning the program, recording the ledger row and sending the
// "set your password" invite all stay in `grantFunnelPurchase`, which this
// delegates to. A second implementation would be two sets of rules about who
// gets access to what, drifting apart from the day it was written — and the
// half that took real money at Stripe is not the half you want to discover was
// the more careful one.
//
// What lives here is the four questions checkout never has to ask, because a
// Stripe session answers them by existing:
//
//   1. Is this deal actually won?
//   2. Did it already come through checkout, and so is already provisioned?
//   3. Do we know where to send the invite?
//   4. Has this card already been granted?
//
// (4) is not asked here either — it is `grantFunnelPurchase`'s idempotency
// check, reached because the opportunity id IS the idempotency key on this
// path. One card, one grant, forever, enforced by a unique index (00235)
// rather than by how carefully the screen prevents a second click.
//
// PROMPTED, NEVER AUTOMATIC. Won is not enough information to grant on its own:
// a card can be a cash deal, a camp, or a plan nobody has priced. The program
// arrives as an argument because a human chose it. Auto-granting from the
// card's value would mean a mis-dragged card sends a real stranger a real
// email about an account they never asked for.

import type { FunnelPurchase, GrantResult, GrantStage } from "@/lib/funnels/checkout/grant"

export interface WonOpportunity {
  id: string
  /** null while the card is still open. Only "won" may be granted. */
  outcome: "won" | "lost" | null
  contact_id: string | null
  /** Present when the deal reached Won through a Stripe checkout. */
  source_session_id: string | null
}

export interface ContactIdentity {
  email: string | null
  name: string | null
}

export interface ManualGrantPorts {
  getOpportunity: (opportunityId: string) => Promise<WonOpportunity | null>
  getContactIdentity: (contactId: string) => Promise<ContactIdentity | null>
  /**
   * MUST be `grantFunnelPurchase` wired with opportunity-keyed ledger ports.
   * Typed as the real result so a refusal here and a refusal there read the
   * same way to the caller.
   */
  runGrant: (purchase: FunnelPurchase) => Promise<GrantResult>
}

export type ManualGrantResult =
  | { outcome: "granted"; userId: string; accountCreated: boolean; emailFailed: boolean }
  | { outcome: "already_granted" }
  | { outcome: "provisioned_by_checkout" }
  | { outcome: "not_won" }
  | { outcome: "unknown_opportunity" }
  | { outcome: "no_contact_email" }
  | { outcome: "failed"; stage: GrantStage; error: string }

/**
 * Grant a program to the athlete behind a won pipeline card.
 *
 * Every refusal is a distinct outcome rather than a boolean, because the screen
 * has something different to say for each one and "could not grant" would send
 * a coach hunting for a bug that does not exist.
 *
 * Unlike `grantFunnelPurchase` this MAY throw: it is called from an admin route
 * with a human waiting on the response, not from a Stripe webhook where a throw
 * is a retry storm. A read that fails is allowed to surface as a 500 — being
 * unable to check is not permission to grant.
 */
export async function grantWonOpportunity(
  input: { opportunityId: string; programId: string },
  ports: ManualGrantPorts,
): Promise<ManualGrantResult> {
  const opportunity = await ports.getOpportunity(input.opportunityId)
  if (!opportunity) return { outcome: "unknown_opportunity" }

  // Won only. A card sitting in Consult Booked has not bought anything, and an
  // open card's value is a forecast, not a purchase.
  if (opportunity.outcome !== "won") return { outcome: "not_won" }

  // A deal that reached Won through checkout was already provisioned by the
  // Stripe webhook, under its own idempotency key. Granting again here would
  // be a second grant that the ledger cannot see as a duplicate, because the
  // two paths key on different columns.
  if (opportunity.source_session_id) return { outcome: "provisioned_by_checkout" }

  if (!opportunity.contact_id) return { outcome: "no_contact_email" }
  const identity = await ports.getContactIdentity(opportunity.contact_id)
  // No email is a refusal, not a guess. The invite is the whole deliverable;
  // creating an account nobody can be told about helps no one.
  if (!identity?.email) return { outcome: "no_contact_email" }

  const result = await ports.runGrant({
    // The card IS the key. See this file's header and migration 00235.
    idempotencyKey: opportunity.id,
    email: identity.email,
    name: identity.name,
    productKind: "program",
    productId: input.programId,
    leadId: null,
  })

  if (!result.ok) return { outcome: "failed", stage: result.stage, error: result.error }
  if (result.outcome === "already_processed") return { outcome: "already_granted" }

  return {
    outcome: "granted",
    userId: result.userId,
    accountCreated: result.accountCreated,
    emailFailed: result.emailFailed,
  }
}
