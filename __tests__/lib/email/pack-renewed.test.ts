// Tests the actual rendered output of the PackRenewedEmail template directly
// (no `resend` mock involved) — __tests__/lib/email-pack-renewed.test.ts
// covers the sender's behavior (to/cc resolution, subject, non-throwing on
// a Resend error). This file exists so a change that silently drops the
// amount, the client's name, or the opt-out wording from the template is
// caught even if the sender-level assertions happen not to probe that text.
import { describe, it, expect } from "vitest"
import { renderPackRenewedEmail, formatCurrency } from "@/components/emails/PackRenewedEmail"

describe("renderPackRenewedEmail", () => {
  it("names the amount charged and how to stop future renewals", async () => {
    const html = await renderPackRenewedEmail({
      firstName: "Pat",
      clientName: "Sirisha",
      packLabel: "10× training",
      amountCents: 75000,
    })
    expect(html).toContain("$750.00")
    expect(html).toContain("Sirisha")
    expect(html).toMatch(/turn off|cancel|stop/i)
  })

  it("names what was bought and that the charge was automatic", async () => {
    const html = await renderPackRenewedEmail({
      firstName: "Pat",
      clientName: "Sirisha",
      packLabel: "10× Performance training",
      amountCents: 75000,
    })
    expect(html).toContain("10× Performance training")
    expect(html).toMatch(/automatic|auto-renew/i)
  })

  it("never leaks raw cents into the markup", async () => {
    const html = await renderPackRenewedEmail({
      firstName: "Pat",
      clientName: "Sirisha",
      packLabel: "10× training",
      amountCents: 75000,
    })
    expect(html).not.toContain("75000")
  })
})

describe("formatCurrency", () => {
  it("formats cents as dollars with two decimal places and thousands separators", () => {
    expect(formatCurrency(150000)).toBe("$1,500.00")
    expect(formatCurrency(75000)).toBe("$750.00")
    expect(formatCurrency(1)).toBe("$0.01")
  })
})
