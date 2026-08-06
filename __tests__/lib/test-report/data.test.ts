import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/users", () => ({ getUserById: vi.fn() }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: vi.fn() }))
vi.mock("@/lib/db/performance-tests", () => ({ listByUser: vi.fn() }))
vi.mock("@/lib/profile-share/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile-share/data")>()
  return { ...actual, loadPublicAssessments: vi.fn() }
})

import { getTestReportData } from "@/lib/test-report/data"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { listByUser } from "@/lib/db/performance-tests"
import { loadPublicAssessments } from "@/lib/profile-share/data"

const activeClient = {
  id: "u1",
  first_name: "Marcus",
  last_name: "Johnson",
  email: "marcus@example.com",
  avatar_url: null,
  role: "client",
  status: "active",
  created_at: "2024-03-10T00:00:00Z",
}

const rawTest = {
  id: "t1",
  client_user_id: "u1",
  created_by: "admin1",
  test_type: "cmj",
  custom_name: null,
  result_value: 45,
  result_unit: "cm",
  trial_values: [44, 45],
  best_method: "highest",
  test_date: "2026-06-01",
  body_weight_kg: 84,
  notes: "INTERNAL: knee felt tight, watch this",
  video_url: "https://storage.example.com/private-form-check.mp4",
  is_pr: true,
  pct_change_from_prev: 4.6,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
}

beforeEach(() => {
  vi.mocked(getUserById).mockResolvedValue(activeClient as never)
  vi.mocked(getProfileByUserId).mockResolvedValue({
    sport: "Basketball",
    position: "Point Guard",
    date_of_birth: "2002-01-15",
  } as never)
  vi.mocked(listByUser).mockResolvedValue([rawTest] as never)
  vi.mocked(loadPublicAssessments).mockResolvedValue([])
})

describe("getTestReportData", () => {
  it("assembles identity, tests and derived counts", async () => {
    const d = await getTestReportData("u1")
    expect(d).not.toBeNull()
    expect(d!.name).toEqual({ first: "Marcus", last: "Johnson" })
    expect(d!.sport).toBe("Basketball")
    expect(d!.age).toBeGreaterThan(20)
    expect(d!.tests).toHaveLength(1)
    expect(d!.tests[0]).toMatchObject({ testType: "cmj", resultValue: 45, isPr: true })
    expect(d!.testCount).toBe(1)
    expect(d!.prCount).toBe(1)
    expect(d!.asOf).toBe("2026-06-01")
  })

  it("NEVER leaks coach-private fields into the public payload", async () => {
    const d = await getTestReportData("u1")
    const serialized = JSON.stringify(d)
    expect(serialized).not.toContain("INTERNAL")
    expect(serialized).not.toContain("private-form-check")
    expect(serialized).not.toContain("marcus@example.com")
    expect(serialized).not.toContain("2002-01-15") // DOB — age only
    expect(serialized).not.toContain("admin1")
    for (const key of ["notes", "video_url", "created_by", "client_user_id"]) {
      expect(serialized).not.toContain(`"${key}"`)
    }
  })

  it("returns null for a non-client, an inactive client, or a missing user", async () => {
    vi.mocked(getUserById).mockResolvedValue({ ...activeClient, role: "admin" } as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockResolvedValue({ ...activeClient, status: "inactive" } as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockResolvedValue(null as never)
    expect(await getTestReportData("u1")).toBeNull()

    vi.mocked(getUserById).mockRejectedValue(new Error("db down"))
    expect(await getTestReportData("u1")).toBeNull()
  })

  it("degrades to empty sections when a data source throws", async () => {
    vi.mocked(listByUser).mockRejectedValue(new Error("timeout"))
    vi.mocked(loadPublicAssessments).mockRejectedValue(new Error("timeout"))
    const d = await getTestReportData("u1")
    expect(d).not.toBeNull()
    expect(d!.tests).toEqual([])
    expect(d!.assessments).toEqual([])
    expect(d!.asOf).toBeNull()
  })

  it("renders without a client_profiles row", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValue(null as never)
    const d = await getTestReportData("u1")
    expect(d!.sport).toBeNull()
    expect(d!.age).toBeNull()
  })

  it("counts months tracked between the first and last test", async () => {
    vi.mocked(listByUser).mockResolvedValue([
      { ...rawTest, id: "t0", test_date: "2026-01-15", is_pr: false },
      { ...rawTest, id: "t1", test_date: "2026-07-01" },
    ] as never)
    const d = await getTestReportData("u1")
    expect(d!.monthsTracked).toBe(6)
    expect(d!.asOf).toBe("2026-07-01")
    expect(d!.testCount).toBe(2)
    expect(d!.prCount).toBe(1)
  })
})
