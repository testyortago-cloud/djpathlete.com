import { describe, it, expect } from "vitest"
import { sendInviteSchema, claimInviteSchema } from "@/lib/validators/team-invite"

describe("sendInviteSchema", () => {
  it("accepts an invite with no permissions — that is an editor invite", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.permissions).toEqual({})
  })
  it("accepts an invite carrying a permission map", () => {
    const r = sendInviteSchema.safeParse({
      email: "kate@example.com",
      staffRole: "coach",
      permissions: { clients: true },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.permissions).toEqual({ clients: true })
  })
  it("ignores a role sent by the client — the server derives it from the permissions", () => {
    // Accepting a role here is how the body could claim "staff" while granting
    // nothing, or claim "editor" while granting the books.
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", role: "admin" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).not.toHaveProperty("role")
  })
  it("rejects an unknown preset", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", staffRole: "owner" })
    expect(r.success).toBe(false)
  })
  it("rejects bad email", () => {
    const r = sendInviteSchema.safeParse({ email: "not-an-email" })
    expect(r.success).toBe(false)
  })
  it("normalizes email: trims whitespace and lowercases", () => {
    const r = sendInviteSchema.safeParse({ email: "  Kate@Example.COM  " })
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
