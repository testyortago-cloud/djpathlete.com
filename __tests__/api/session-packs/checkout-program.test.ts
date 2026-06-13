import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const getProductByIdMock = vi.fn()
const createClientPackageMock = vi.fn()
const createPackCheckoutSessionMock = vi.fn()
const assignProgramMock = vi.fn()
const getAssignmentByUserAndProgramMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/session-pack-products", () => ({ getProductById: (...a: unknown[]) => getProductByIdMock(...a) }))
vi.mock("@/lib/db/client-packages", () => ({ createClientPackage: (...a: unknown[]) => createClientPackageMock(...a) }))
vi.mock("@/lib/db/session-checkins", () => ({}))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: () => ({}) }))
vi.mock("@/lib/stripe", () => ({ createPackCheckoutSession: (...a: unknown[]) => createPackCheckoutSessionMock(...a) }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/assign-program", () => ({ assignProgram: (...a: unknown[]) => assignProgramMock(...a) }))
vi.mock("@/lib/db/assignments", () => ({
  getAssignmentByUserAndProgram: (...a: unknown[]) => getAssignmentByUserAndProgramMock(...a),
}))

import { POST } from "@/app/api/admin/session-packs/checkout/route"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "22222222-2222-4222-8222-222222222222"
const PROGRAM = "33333333-3333-4333-8333-333333333333"

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/session-packs/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "coach-1", role: "admin" } })
  getProductByIdMock.mockResolvedValue({
    id: PRODUCT,
    name: "10x 1-on-1",
    session_type: "1-on-1",
    credits: 10,
    price_cents: 50000,
    validity_days: 90,
    stripe_price_id: null,
  })
  createClientPackageMock.mockImplementation(async (p) => ({ id: "pkg-1", ...p }))
})

describe("POST /api/admin/session-packs/checkout — program link", () => {
  it("assigns the program complimentary and stores assignment_id on the pack", async () => {
    assignProgramMock.mockResolvedValue({ assignment: { id: "asg-1" }, skipped: false })
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "cash", programId: PROGRAM }))
    expect(res.status).toBe(201)
    expect(assignProgramMock).toHaveBeenCalledWith(
      expect.objectContaining({ programId: PROGRAM, userId: CLIENT, complimentary: true }),
    )
    expect(createClientPackageMock).toHaveBeenCalledWith(expect.objectContaining({ assignment_id: "asg-1" }))
  })

  it("reuses an existing active assignment when assignProgram skips", async () => {
    assignProgramMock.mockResolvedValue({ assignment: null, skipped: true })
    getAssignmentByUserAndProgramMock.mockResolvedValue({ id: "asg-existing" })
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "cash", programId: PROGRAM }))
    expect(res.status).toBe(201)
    expect(createClientPackageMock).toHaveBeenCalledWith(expect.objectContaining({ assignment_id: "asg-existing" }))
  })

  it("leaves assignment_id null when no program is given", async () => {
    const res = await POST(req({ clientUserId: CLIENT, productId: PRODUCT, paymentMethod: "cash" }))
    expect(res.status).toBe(201)
    expect(assignProgramMock).not.toHaveBeenCalled()
    expect(createClientPackageMock).toHaveBeenCalledWith(expect.objectContaining({ assignment_id: null }))
  })
})
