import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  versions: { data: [] as unknown[], error: null as unknown },
  comments: { data: [] as unknown[], error: null as unknown },
  fromCalls: [] as string[],
  eqCalls: [] as Array<[string, string]>,
}))

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      h.fromCalls.push(table)
      if (table === "team_video_versions") {
        return { select: () => ({ in: () => Promise.resolve(h.versions) }) }
      }
      return {
        select: () => ({
          in: () => ({
            eq: (col: string, val: string) => {
              h.eqCalls.push([col, val])
              return Promise.resolve(h.comments)
            },
          }),
        }),
      }
    },
  }),
}))

import { countOpenNotesOnCurrentVersions } from "@/lib/db/team-video-comments"

beforeEach(() => {
  h.versions = { data: [], error: null }
  h.comments = { data: [], error: null }
  h.fromCalls = []
  h.eqCalls = []
})

describe("countOpenNotesOnCurrentVersions", () => {
  it("counts only the highest version's notes, ignoring superseded cuts", async () => {
    // The live Liam shape: an open note on v1, a delivered v2 with none.
    // Counting v1 here would falsely flag a submission the editor already
    // acted on — the exact false alarm this scoping exists to prevent.
    h.versions = {
      data: [
        { id: "v1", submission_id: "liam", version_number: 1 },
        { id: "v2", submission_id: "liam", version_number: 2 },
      ],
      error: null,
    }
    h.comments = { data: [], error: null }

    const counts = await countOpenNotesOnCurrentVersions(["liam"])
    expect(counts.get("liam")).toBe(0)
  })

  it("counts open notes that sit on the current version", async () => {
    h.versions = {
      data: [
        { id: "v1", submission_id: "liam", version_number: 1 },
        { id: "v2", submission_id: "liam", version_number: 2 },
      ],
      error: null,
    }
    h.comments = {
      data: [{ version_id: "v2" }, { version_id: "v2" }, { version_id: "v1" }],
      error: null,
    }

    const counts = await countOpenNotesOnCurrentVersions(["liam"])
    // 2, not 3 — the stray v1 row must not be tallied even if it comes back.
    expect(counts.get("liam")).toBe(2)
  })

  it("handles many submissions independently", async () => {
    h.versions = {
      data: [
        { id: "a1", submission_id: "a", version_number: 1 },
        { id: "b1", submission_id: "b", version_number: 1 },
        { id: "b2", submission_id: "b", version_number: 2 },
        { id: "c1", submission_id: "c", version_number: 1 },
      ],
      error: null,
    }
    h.comments = {
      data: [{ version_id: "a1" }, { version_id: "b2" }, { version_id: "b2" }],
      error: null,
    }

    const counts = await countOpenNotesOnCurrentVersions(["a", "b", "c"])
    expect(counts.get("a")).toBe(1)
    expect(counts.get("b")).toBe(2)
    // Present and zero, not absent — callers read it as a number.
    expect(counts.get("c")).toBe(0)
  })

  it("filters to open comments only", async () => {
    h.versions = {
      data: [{ id: "v1", submission_id: "a", version_number: 1 }],
      error: null,
    }
    await countOpenNotesOnCurrentVersions(["a"])
    expect(h.eqCalls).toContainEqual(["status", "open"])
  })

  it("short-circuits on empty input without touching the database", async () => {
    const counts = await countOpenNotesOnCurrentVersions([])
    expect(counts.size).toBe(0)
    expect(h.fromCalls).toEqual([])
  })

  it("skips the comment query when no versions exist yet", async () => {
    h.versions = { data: [], error: null }
    const counts = await countOpenNotesOnCurrentVersions(["brand-new"])
    expect(counts.size).toBe(0)
    expect(h.fromCalls).toEqual(["team_video_versions"])
  })

  it("throws when the version lookup fails rather than reporting zero notes", async () => {
    h.versions = { data: null, error: { message: "boom" } }
    await expect(countOpenNotesOnCurrentVersions(["a"])).rejects.toBeTruthy()
  })
})
