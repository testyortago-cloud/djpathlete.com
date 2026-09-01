// lib/funnels/checkout/grant.ts — what happens after an anonymous buyer pays.
//
// ---------------------------------------------------------------------------
// THIS IS THE MONEY LOGIC, AND IT TAKES ITS DEPENDENCIES AS ARGUMENTS.
// ---------------------------------------------------------------------------
// Everything that touches Stripe, Postgres or email is injected, so every rule
// below can be tested for real rather than mocked into agreement: replay a
// webhook and see one grant, hand it an email that already belongs to a client
// and see nothing created, fail the grant and see an alert rather than silence.
//
// Spec: docs/superpowers/specs/2026-08-15-funnel-anonymous-checkout-design.md
//
// ---------------------------------------------------------------------------
// THE ORDER OF OPERATIONS IS THE DESIGN. IT IS NOT ARBITRARY.
// ---------------------------------------------------------------------------
//
//   1. Have we already processed this checkout session?  -> stop.
//   2. Find the client by email.  FIND, then create — never the reverse.
//   3. Grant the product THROUGH THE EXISTING GATE.
//   4. Record that this session is done.
//   5. Only now, and only for a brand-new account, send the password email.
//
// Step 5 sits last on purpose. An email that fails to send is an annoyance the
// owner can fix by resending; a grant that fails after the email has promised
// the buyer their program is a support conversation. So the irreversible,
// outward-facing step goes after the reversible internal ones.
//
// Step 4 sits after step 3 for the opposite reason: if recording fails, a
// replay re-runs the grant, and `assignProgram` already refuses to duplicate an
// active assignment (`{ skipped: true }`). Recording first would mean a failed
// grant could never be retried, because the replay would see the session as
// done and stop at step 1. Between "might do harmless work twice" and "might
// never do the work at all", this picks the first.

export type FunnelProductKind = "program"

/** What a caller knows about a purchase to be granted. */
export interface FunnelPurchase {
  /**
   * THE IDEMPOTENCY KEY FOR THE WHOLE OPERATION, and the only thing this
   * module does with it is hand it back to `hasProcessed` / `recordProcessed`.
   * It was called `sessionId` while Stripe checkout was the only caller; the
   * name was renamed rather than a second copy of this sequence being written
   * for the manual path, because the grant rules — find or create the client,
   * assign, record, invite — must not be able to drift between the flow that
   * took money at Stripe and the flow where a coach marked a deal won.
   *
   * Checkout passes the Stripe checkout session id. A won pipeline card passes
   * its opportunity id. Both are "one of these, forever".
   */
  idempotencyKey: string
  email: string
  name: string | null
  productKind: FunnelProductKind
  productId: string
  /** The lead captured before checkout, when there was one. */
  leadId: string | null
}

export interface ExistingClient {
  id: string
  /** False for a client who has never set one — an admin-created record. */
  hasPassword: boolean
}

export interface GrantDeps {
  /** Null when no client has this email. Case-insensitivity is the DAL's job. */
  findClientByEmail: (email: string) => Promise<ExistingClient | null>
  createClient: (input: { email: string; name: string | null }) => Promise<{ id: string }>
  /**
   * MUST be the real `assignProgram`, which runs `assertAssignmentPayable`.
   * Writing an assignment row directly would make the one flow that definitely
   * took the money the one flow that skips the unpaid-access check.
   */
  assignProgram: (input: { programId: string; userId: string }) => Promise<{ skipped: boolean }>
  hasProcessed: (idempotencyKey: string) => Promise<boolean>
  recordProcessed: (input: {
    idempotencyKey: string
    userId: string
    purchase: FunnelPurchase
    accountCreated: boolean
  }) => Promise<void>
  sendSetPasswordEmail: (input: { userId: string; email: string; name: string | null }) => Promise<void>
  /** Paid but not delivered. Must reach a human — never just a log line. */
  alertFailure: (input: { purchase: FunnelPurchase; stage: GrantStage; error: string }) => Promise<void>
}

export type GrantStage = "find_client" | "create_client" | "grant" | "record" | "email"

export type GrantResult =
  | {
      ok: true
      outcome: "granted" | "already_processed"
      userId: string
      accountCreated: boolean
      /** True when the grant was skipped because they already had it. */
      alreadyOwned: boolean
      /** The account exists and is granted, but the welcome email did not send. */
      emailFailed: boolean
    }
  | { ok: false; stage: GrantStage; error: string }

/** Never throws. A throw inside a Stripe webhook is a retry storm, not a report. */
export async function grantFunnelPurchase(
  purchase: FunnelPurchase,
  deps: GrantDeps,
): Promise<GrantResult> {
  // 1. Stripe retries webhooks, sometimes for days. Without this, a retry after
  //    a slow response grants a second program and sends a second "set your
  //    password" email to someone who has already set one.
  try {
    if (await deps.hasProcessed(purchase.idempotencyKey)) {
      return {
        ok: true,
        outcome: "already_processed",
        userId: "",
        accountCreated: false,
        alreadyOwned: false,
        emailFailed: false,
      }
    }
  } catch (error) {
    // A ledger that cannot be read is NOT permission to proceed: proceeding
    // would risk the double grant this check exists to prevent, on a path where
    // the money has already moved.
    return { ok: false, stage: "record", error: message(error) }
  }

  // 2. FIND BEFORE CREATE. The person most likely to buy from a landing page
  //    with an email you already hold is a returning customer, and giving them
  //    a second account splits one athlete's training history across two
  //    logins — with the program on the login they are not using.
  let client: ExistingClient | null
  try {
    client = await deps.findClientByEmail(purchase.email)
  } catch (error) {
    await safeAlert(deps, purchase, "find_client", message(error))
    return { ok: false, stage: "find_client", error: message(error) }
  }

  let accountCreated = false
  if (!client) {
    try {
      const created = await deps.createClient({ email: purchase.email, name: purchase.name })
      client = { id: created.id, hasPassword: false }
      accountCreated = true
    } catch (error) {
      await safeAlert(deps, purchase, "create_client", message(error))
      return { ok: false, stage: "create_client", error: message(error) }
    }
  }

  // 3. Through the gate, never around it.
  let alreadyOwned = false
  try {
    const result = await deps.assignProgram({ programId: purchase.productId, userId: client.id })
    alreadyOwned = result.skipped
  } catch (error) {
    await safeAlert(deps, purchase, "grant", message(error))
    return { ok: false, stage: "grant", error: message(error) }
  }

  // 4. See the header: recorded AFTER the grant so a failure here is retryable.
  try {
    await deps.recordProcessed({
      idempotencyKey: purchase.idempotencyKey,
      userId: client.id,
      purchase,
      accountCreated,
    })
  } catch (error) {
    await safeAlert(deps, purchase, "record", message(error))
    return { ok: false, stage: "record", error: message(error) }
  }

  // 5. Last, and only for an account that has no password yet.
  //
  //    A CLIENT THE COACH CREATED BY HAND HAS `hasPassword: false` TOO, and
  //    that is the case this condition is really for: they should be invited to
  //    set one. A client who already has a password must never be sent a
  //    "set your password" email for buying something — it reads as a breach.
  let emailFailed = false
  if (!client.hasPassword) {
    try {
      await deps.sendSetPasswordEmail({
        userId: client.id,
        email: purchase.email,
        name: purchase.name,
      })
    } catch (error) {
      // NOT a failure of the purchase. They paid, they have the program, and
      // the account exists — the email is recoverable by resending it. Undoing
      // the grant because an SMTP call failed would be the worse trade.
      emailFailed = true
      await safeAlert(deps, purchase, "email", message(error))
    }
  }

  return {
    ok: true,
    outcome: "granted",
    userId: client.id,
    accountCreated,
    alreadyOwned,
    emailFailed,
  }
}

/** An alert that throws must not replace the failure it was reporting. */
async function safeAlert(
  deps: GrantDeps,
  purchase: FunnelPurchase,
  stage: GrantStage,
  error: string,
): Promise<void> {
  try {
    await deps.alertFailure({ purchase, stage, error })
  } catch (alertError) {
    console.error("[funnel-checkout] the failure alert itself failed:", alertError)
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
