import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/test-report/data", () => ({ getTestReportData: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

import { getTestReportData } from "@/lib/test-report/data"
import { signAthleteProfileToken } from "@/lib/profile-share/token"
import AthleteProfilePage, { generateMetadata } from "@/app/athlete/[token]/page"

const data = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  age: 24,
  asOf: "2026-07-01",
  testCount: 2,
  prCount: 1,
  monthsTracked: 6,
  tests: [],
  assessments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTestReportData).mockResolvedValue(data as never)
})

describe("/athlete/[token]", () => {
  it("renders the test report for a valid token", async () => {
    const token = signAthleteProfileToken("u1")
    const el = await AthleteProfilePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) })
    expect(el).toBeTruthy()
    expect(getTestReportData).toHaveBeenCalledWith("u1")
  })

  it("defaults to the light theme and honours ?theme=dark", async () => {
    const token = signAthleteProfileToken("u1")
    const light = (await AthleteProfilePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    })) as { props: { theme: string } }
    expect(light.props.theme).toBe("light")

    const dark = (await AthleteProfilePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({ theme: "dark" }),
    })) as { props: { theme: string } }
    expect(dark.props.theme).toBe("dark")

    // Anything else falls back to light rather than passing junk through.
    const junk = (await AthleteProfilePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({ theme: "neon" }),
    })) as { props: { theme: string } }
    expect(junk.props.theme).toBe("light")
  })

  it("404s on a tampered token without ever hitting the database", async () => {
    const token = `${signAthleteProfileToken("u1")}tampered`
    await expect(AthleteProfilePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(getTestReportData).not.toHaveBeenCalled()
  })

  it("404s when the client is not eligible for a public report", async () => {
    vi.mocked(getTestReportData).mockResolvedValue(null as never)
    const token = signAthleteProfileToken("u1")
    await expect(AthleteProfilePage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("titles the page as a test report and keeps it out of search engines", async () => {
    const token = signAthleteProfileToken("u1")
    const meta = await generateMetadata({ params: Promise.resolve({ token }) })
    expect(meta.title).toMatch(/Test Report/i)
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it("keeps an invalid token's metadata generic and still noindexed", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ token: "nonsense" }) })
    expect(meta.title).toBe("Test Report")
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect(getTestReportData).not.toHaveBeenCalled()
  })
})
