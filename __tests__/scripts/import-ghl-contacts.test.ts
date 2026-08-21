// @vitest-environment node
//
// Unit tests for the pure progress-file logic in
// scripts/import-ghl-contacts.ts — the part of a resumable --execute run
// that decides which ghl ids to skip on re-run. Deliberately does NOT
// import or exercise `main()` (guarded behind the `import.meta.url` check
// at the bottom of the script, so importing this module for its exports
// never runs argv parsing, file reads, or a Supabase client). No fixture
// here touches lib/lead-engine/import.ts's DB-touching code at all.
import { describe, it, expect } from "vitest"
import { parseImportProgress, isAlreadyImported, withRecordDone } from "../../scripts/import-ghl-contacts"

describe("parseImportProgress", () => {
  it("returns an empty set when there is no prior progress file (null)", () => {
    expect(parseImportProgress(null)).toEqual(new Set())
  })

  it("returns an empty set for a blank/whitespace-only file", () => {
    expect(parseImportProgress("   \n")).toEqual(new Set())
  })

  it("parses a written progress file's doneIds back into a Set", () => {
    const raw = JSON.stringify({ doneIds: ["ghl-1", "ghl-2"] })
    expect(parseImportProgress(raw)).toEqual(new Set(["ghl-1", "ghl-2"]))
  })

  it("treats a missing doneIds key as no progress rather than throwing", () => {
    expect(parseImportProgress(JSON.stringify({}))).toEqual(new Set())
  })
})

describe("isAlreadyImported", () => {
  it("is false when the id is not in the done set", () => {
    expect(isAlreadyImported(new Set(["a", "b"]), "c")).toBe(false)
  })

  it("is true when the id is in the done set", () => {
    expect(isAlreadyImported(new Set(["a", "b"]), "b")).toBe(true)
  })

  it("is false against an empty done set (first run, nothing skipped yet)", () => {
    expect(isAlreadyImported(new Set(), "anything")).toBe(false)
  })
})

describe("withRecordDone", () => {
  it("adds a new id to an empty progress set", () => {
    expect(withRecordDone(new Set(), "ghl-1")).toEqual({ doneIds: ["ghl-1"] })
  })

  it("appends to an existing set without dropping earlier ids", () => {
    const out = withRecordDone(new Set(["ghl-1"]), "ghl-2")
    expect(new Set(out.doneIds)).toEqual(new Set(["ghl-1", "ghl-2"]))
    expect(out.doneIds).toHaveLength(2)
  })

  it("re-adding an id already marked done does not duplicate it", () => {
    const out = withRecordDone(new Set(["ghl-1", "ghl-2"]), "ghl-1")
    expect(out.doneIds).toHaveLength(2)
    expect(new Set(out.doneIds)).toEqual(new Set(["ghl-1", "ghl-2"]))
  })
})
