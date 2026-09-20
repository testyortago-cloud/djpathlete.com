import { describe, it, expect, vi, beforeEach } from "vitest"

const getSignedUrlMock = vi.fn()
const versionsMock = vi.fn()
const imagesMock = vi.fn()

vi.mock("@/lib/firebase-admin", () => ({
  getAdminStorage: () => ({ bucket: () => ({ file: (p: string) => ({ getSignedUrl: () => getSignedUrlMock(p) }) }) }),
}))
vi.mock("@/lib/db/team-video-submissions", () => ({
  listCurrentVersionsForSubmissions: (...a: unknown[]) => versionsMock(...a),
  listFirstImageForSubmissions: (...a: unknown[]) => imagesMock(...a),
}))

import { signSubmissionThumbnails } from "@/lib/team-videos/thumbnails"

describe("signSubmissionThumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSignedUrlMock.mockImplementation(async (p: string) => [`https://signed/${p}`])
    imagesMock.mockResolvedValue(new Map())
  })

  it("keys the result by SUBMISSION id, not version id", async () => {
    versionsMock.mockResolvedValue(new Map([["sub1", { id: "ver1", thumbnail_path: "t/a.jpg", kind: "video" }]]))
    const out = await signSubmissionThumbnails(["sub1"])
    expect(out).toEqual({ sub1: "https://signed/t/a.jpg" })
  })

  it("skips a version with no thumbnail rather than signing null", async () => {
    versionsMock.mockResolvedValue(new Map([["sub1", { id: "ver1", thumbnail_path: null, kind: "video" }]]))
    expect(await signSubmissionThumbnails(["sub1"])).toEqual({})
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it("uses the first image for an image-set submission, not a video frame", async () => {
    versionsMock.mockResolvedValue(new Map([["sub2", { id: "ver2", thumbnail_path: null, kind: "image_set" }]]))
    imagesMock.mockResolvedValue(new Map([["sub2", "team/images/first.png"]]))
    expect(await signSubmissionThumbnails(["sub2"])).toEqual({ sub2: "https://signed/team/images/first.png" })
  })

  it("drops one unsignable path without losing the others", async () => {
    versionsMock.mockResolvedValue(
      new Map([
        ["sub1", { id: "v1", thumbnail_path: "ok.jpg", kind: "video" }],
        ["sub2", { id: "v2", thumbnail_path: "gone.jpg", kind: "video" }],
      ]),
    )
    getSignedUrlMock.mockImplementation(async (p: string) => {
      if (p === "gone.jpg") throw new Error("404")
      return [`https://signed/${p}`]
    })
    expect(await signSubmissionThumbnails(["sub1", "sub2"])).toEqual({ sub1: "https://signed/ok.jpg" })
  })

  it("returns {} for an empty id list without touching storage", async () => {
    expect(await signSubmissionThumbnails([])).toEqual({})
    expect(versionsMock).not.toHaveBeenCalled()
  })

  // Deploy-window tolerance: Vercel's build and the migration that adds
  // team_video_versions.thumbnail_path (00265) race on merge to main, so for
  // one deploy this read can hit the old schema. That surfaces as Postgres
  // 42703 (double-quoted column name) because listCurrentVersionsForSubmissions
  // is a .select() — a READ — not PostgREST's PGRST204 (single-quoted), which
  // only writes see. A fixture built from the PGRST204 shape would pass
  // identically against a blanket catch, a code-keyed catch, or a
  // text-matching catch, and would prove nothing about this code path.
  it("degrades to {} on a missing-column error (42703) instead of throwing", async () => {
    versionsMock.mockRejectedValue({
      code: "42703",
      message: 'column "thumbnail_path" of relation "team_video_versions" does not exist',
    })
    await expect(signSubmissionThumbnails(["sub1"])).resolves.toEqual({})
  })

  // This arm is what makes the arm above mean anything: without it, a
  // blanket `catch { return {} }` would pass every test in this file. A real
  // outage (permission denied, RLS misconfigured, PostgREST down) must still
  // reach the caller as a throw, not silently render an empty board forever.
  it("rethrows a non-missing-column error rather than swallowing it", async () => {
    versionsMock.mockRejectedValue({ code: "42501", message: "permission denied" })
    await expect(signSubmissionThumbnails(["sub1"])).rejects.toMatchObject({ code: "42501" })
  })
})
