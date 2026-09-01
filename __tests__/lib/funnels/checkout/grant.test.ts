// The money logic, tested for real rather than mocked into agreement.
//
// `grantFunnelPurchase` takes its dependencies as arguments precisely so these
// can be honest: a replayed webhook really does run the whole function twice, a
// failing grant really does throw, and what is asserted is what the caller
// would actually observe.
//
// Every test here maps to a line in the spec's "what to test" table.

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  grantFunnelPurchase,
  type FunnelPurchase,
  type GrantDeps,
  type ExistingClient,
} from "@/lib/funnels/checkout/grant"

const purchase: FunnelPurchase = {
  idempotencyKey: "cs_test_123",
  email: "jordan@example.com",
  name: "Jordan",
  productKind: "program",
  productId: "prog-1",
  leadId: "lead-1",
}

function deps(overrides: Partial<GrantDeps> = {}): GrantDeps {
  return {
    findClientByEmail: vi.fn(async () => null as ExistingClient | null),
    createClient: vi.fn(async () => ({ id: "user-new" })),
    assignProgram: vi.fn(async () => ({ skipped: false })),
    hasProcessed: vi.fn(async () => false),
    recordProcessed: vi.fn(async () => {}),
    sendSetPasswordEmail: vi.fn(async () => {}),
    alertFailure: vi.fn(async () => {}),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a first-time buyer", () => {
  it("creates the account, grants the program, and invites them to set a password", async () => {
    const d = deps()
    const result = await grantFunnelPurchase(purchase, d)

    expect(result).toMatchObject({ ok: true, outcome: "granted", accountCreated: true })
    expect(d.createClient).toHaveBeenCalledWith({ email: "jordan@example.com", name: "Jordan" })
    expect(d.assignProgram).toHaveBeenCalledWith({ programId: "prog-1", userId: "user-new" })
    expect(d.sendSetPasswordEmail).toHaveBeenCalledTimes(1)
  })

  it("grants through assignProgram and never writes an assignment itself", async () => {
    // `assignProgram` runs `assertAssignmentPayable`. Writing the row directly
    // would make the one flow that definitely took the money the one flow that
    // skips the unpaid-access check.
    const d = deps()
    await grantFunnelPurchase(purchase, d)
    expect(d.assignProgram).toHaveBeenCalledTimes(1)
  })
})

describe("a returning buyer", () => {
  it("attaches the purchase to the existing client and creates nothing", async () => {
    // MUTANT KILLED: create-then-find, or create unconditionally. A second
    // account splits one athlete's history across two logins — with the program
    // on the login they are not using.
    const d = deps({
      findClientByEmail: vi.fn(async () => ({ id: "user-existing", hasPassword: true })),
    })

    const result = await grantFunnelPurchase(purchase, d)

    expect(result).toMatchObject({ ok: true, accountCreated: false, userId: "user-existing" })
    expect(d.createClient).not.toHaveBeenCalled()
    expect(d.assignProgram).toHaveBeenCalledWith({ programId: "prog-1", userId: "user-existing" })
  })

  it("never sends a set-password email to someone who already has one", async () => {
    // It reads as a breach notification, not a welcome.
    const d = deps({
      findClientByEmail: vi.fn(async () => ({ id: "user-existing", hasPassword: true })),
    })
    await grantFunnelPurchase(purchase, d)
    expect(d.sendSetPasswordEmail).not.toHaveBeenCalled()
  })

  it("DOES invite a hand-created client who has never set a password", async () => {
    // A client the coach added by hand has no password. They are exactly who
    // this invitation is for.
    const d = deps({
      findClientByEmail: vi.fn(async () => ({ id: "user-manual", hasPassword: false })),
    })
    await grantFunnelPurchase(purchase, d)
    expect(d.sendSetPasswordEmail).toHaveBeenCalledTimes(1)
  })

  it("reports an already-owned program as success, not as a failure", async () => {
    // `assignProgram` returns `skipped` when an active assignment exists. The
    // buyer paid; refusing here would look like the payment failed.
    const d = deps({
      findClientByEmail: vi.fn(async () => ({ id: "user-existing", hasPassword: true })),
      assignProgram: vi.fn(async () => ({ skipped: true })),
    })
    const result = await grantFunnelPurchase(purchase, d)
    expect(result).toMatchObject({ ok: true, alreadyOwned: true })
  })
})

describe("Stripe replaying the webhook", () => {
  it("does nothing the second time", async () => {
    // Stripe retries for days. Without this, a retry after a slow response
    // grants a second program and emails someone who has already set a password.
    const d = deps({ hasProcessed: vi.fn(async () => true) })

    const result = await grantFunnelPurchase(purchase, d)

    expect(result).toMatchObject({ ok: true, outcome: "already_processed" })
    expect(d.createClient).not.toHaveBeenCalled()
    expect(d.assignProgram).not.toHaveBeenCalled()
    expect(d.sendSetPasswordEmail).not.toHaveBeenCalled()
  })

  it("is keyed on the checkout session id", async () => {
    const d = deps()
    await grantFunnelPurchase(purchase, d)
    expect(d.hasProcessed).toHaveBeenCalledWith("cs_test_123")
    expect(d.recordProcessed).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "cs_test_123" }))
  })

  it("refuses to proceed when the ledger cannot be read", async () => {
    // MUTANT KILLED: treating an unreadable ledger as "not processed". That is
    // not permission to proceed — it risks the double grant this check exists
    // to prevent, on a path where the money has already moved.
    const d = deps({
      hasProcessed: vi.fn(async () => {
        throw new Error("postgrest down")
      }),
    })

    const result = await grantFunnelPurchase(purchase, d)

    expect(result.ok).toBe(false)
    expect(d.assignProgram).not.toHaveBeenCalled()
  })
})

describe("paid but not delivered", () => {
  it("alerts a human when the grant fails", async () => {
    const d = deps({
      assignProgram: vi.fn(async () => {
        throw new Error("program archived")
      }),
    })

    const result = await grantFunnelPurchase(purchase, d)

    expect(result).toMatchObject({ ok: false, stage: "grant" })
    expect(d.alertFailure).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "grant", purchase: expect.objectContaining({ idempotencyKey: "cs_test_123" }) }),
    )
  })

  it("alerts when the account cannot be created", async () => {
    const d = deps({
      createClient: vi.fn(async () => {
        throw new Error("duplicate key")
      }),
    })
    const result = await grantFunnelPurchase(purchase, d)
    expect(result).toMatchObject({ ok: false, stage: "create_client" })
    expect(d.alertFailure).toHaveBeenCalled()
  })

  it("does not mark the session processed when the grant failed", async () => {
    // MUTANT KILLED: recording first. A failed grant would then be permanently
    // unretryable, because the replay stops at the idempotency check.
    const d = deps({
      assignProgram: vi.fn(async () => {
        throw new Error("nope")
      }),
    })
    await grantFunnelPurchase(purchase, d)
    expect(d.recordProcessed).not.toHaveBeenCalled()
  })

  it("never throws, whatever fails", async () => {
    // A throw inside a Stripe webhook handler is a retry storm, not a report.
    const d = deps({
      findClientByEmail: vi.fn(async () => {
        throw new Error("boom")
      }),
      alertFailure: vi.fn(async () => {
        throw new Error("the alert broke too")
      }),
    })
    await expect(grantFunnelPurchase(purchase, d)).resolves.toMatchObject({ ok: false })
  })
})

describe("the welcome email failing", () => {
  it("leaves the purchase granted and says so", async () => {
    // They paid, the account exists and the program is assigned. Undoing that
    // because an SMTP call failed would be the worse trade — the email can be
    // resent, the support conversation cannot be un-had.
    const d = deps({
      sendSetPasswordEmail: vi.fn(async () => {
        throw new Error("resend 500")
      }),
    })

    const result = await grantFunnelPurchase(purchase, d)

    expect(result).toMatchObject({ ok: true, outcome: "granted", emailFailed: true })
    expect(d.recordProcessed).toHaveBeenCalled()
    expect(d.alertFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "email" }))
  })

  it("still counts the session as processed, so a replay does not re-grant", async () => {
    const d = deps({
      sendSetPasswordEmail: vi.fn(async () => {
        throw new Error("resend 500")
      }),
    })
    await grantFunnelPurchase(purchase, d)
    expect(d.recordProcessed).toHaveBeenCalledTimes(1)
  })
})
