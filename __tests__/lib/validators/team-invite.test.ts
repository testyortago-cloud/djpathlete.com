import { describe, it, expect } from "vitest"
import { sendInviteSchema, claimInviteSchema } from "@/lib/validators/team-invite"

describe("sendInviteSchema", () => {
  it("accepts a valid editor invite", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", role: "editor" })
    expect(r.success).toBe(true)
  })
  it("rejects unknown roles", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", role: "admin" })
    expect(r.success).toBe(false)
  })
  it("rejects bad email", () => {
    const r = sendInviteSchema.safeParse({ email: "not-an-email", role: "editor" })
    expect(r.success).toBe(false)
  })
})

describe("claimInviteSchema", () => {
  it("accepts a valid claim", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "Kate",
      lastName: "Doe",
      password: "Sup3rstrong!",
    })
    expect(r.success).toBe(true)
  })
  it("rejects short passwords", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "Kate",
      lastName: "Doe",
      password: "short",
    })
    expect(r.success).toBe(false)
  })
  it("rejects missing firstName", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "",
      lastName: "Doe",
      password: "Sup3rstrong!",
    })
    expect(r.success).toBe(false)
  })
})
