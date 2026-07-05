import { describe, it, expect } from "vitest"
import { recurringSlotUpdateSchema } from "@/lib/validators/sessions"

const UUID = "11111111-1111-1111-8111-111111111111"

describe("recurringSlotUpdateSchema — assignmentId (hybrid program link)", () => {
  it("accepts a uuid assignmentId", () => {
    const r = recurringSlotUpdateSchema.safeParse({ assignmentId: UUID })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.assignmentId).toBe(UUID)
  })

  it("accepts null to unlink", () => {
    const r = recurringSlotUpdateSchema.safeParse({ assignmentId: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.assignmentId).toBeNull()
  })

  it("rejects a non-uuid assignmentId", () => {
    expect(recurringSlotUpdateSchema.safeParse({ assignmentId: "not-a-uuid" }).success).toBe(false)
  })

  it("stays optional (existing updates unaffected)", () => {
    const r = recurringSlotUpdateSchema.safeParse({ status: "paused" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.assignmentId).toBeUndefined()
  })
})
