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
  it("normalizes email: trims whitespace and lowercases", () => {
    const r = sendInviteSchema.safeParse({ email: "  Kate@Example.COM  ", role: "editor" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe("kate@example.com")
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
  it("trims first and last name", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "  Kate  ", lastName: " Doe ", password: "Sup3rstrong!",
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.firstName).toBe("Kate")
      expect(r.data.lastName).toBe("Doe")
    }
  })
  it("rejects whitespace-only firstName after trim", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "   ", lastName: "Doe", password: "Sup3rstrong!",
    })
    expect(r.success).toBe(false)
  })
})
