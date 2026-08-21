// @vitest-environment node
//
// Unit tests for the pure progress-file logic in
// scripts/import-ghl-contacts.ts — the part of a resumable --execute run
// that decides which ghl ids to skip on re-run. Deliberately does NOT
// import or exercise `main()` (guarded behind the `import.meta.url` check
// at the bottom of the script, so importing this module for its exports
// never runs argv parsing, file reads, or a Supabase client). No fixture
// here touches lib/lead-engine/import.ts's DB-touching code at all.
import { describe, it, expect, vi } from "vitest"
import {
  parseImportProgress,
  isAlreadyImported,
  withRecordDone,
  processGhlRecords,
} from "../../scripts/import-ghl-contacts"
import type { GhlContactRecord, ImportOutcome } from "@/lib/lead-engine/import"

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

// processGhlRecords is the resumable --execute loop itself, made testable
// by taking its two effectful dependencies (the per-record importer and
// the progress-persist callback) as injected functions rather than
// reaching for the real importGhlContact / fs.writeFileSync directly. The
// real runExecute() wires the real ones in; these tests wire in fakes, so
// the loop's error-isolation semantics — the load-bearing property a code
// review flagged (a poisoned record must not kill the whole run, and must
// stay retryable) — are exercised without touching Supabase or disk.
function record(id: string, overrides: Partial<GhlContactRecord> = {}): GhlContactRecord {
  return {
    id,
    email: `${id}@example.com`,
    phone: null,
    firstName: "Test",
    lastName: id,
    contactName: `Test ${id}`,
    dnd: false,
    dndSettings: {},
    tags: [],
    source: null,
    dateAdded: "2026-08-13T18:52:52.140Z",
    ...overrides,
  }
}

function outcome(kind: ImportOutcome["kind"], overrides: Partial<ImportOutcome> = {}): ImportOutcome {
  return {
    kind,
    contactId: kind === "skipped_no_identifier" ? null : `contact-${Math.random()}`,
    emailConsentImported: false,
    smsRepermissionCandidate: false,
    ...overrides,
  }
}

describe("processGhlRecords", () => {
  it("processes every record successfully: tallies counts, marks each done, calls onProgress per success", async () => {
    const records = [record("a"), record("b")]
    const importOne = vi
      .fn()
      .mockResolvedValueOnce(outcome("created"))
      .mockResolvedValueOnce(outcome("enriched", { merged: true }))
    const onProgress = vi.fn()

    const result = await processGhlRecords(records, new Set(), importOne, onProgress)

    expect(result.failures).toEqual([])
    expect(result.processedThisRun).toBe(2)
    expect(result.skippedAlreadyDone).toBe(0)
    expect(result.counts.created).toBe(1)
    expect(result.counts.enriched).toBe(1)
    expect(result.mergedCount).toBe(1)
    expect(result.doneIds).toEqual(new Set(["a", "b"]))
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(importOne).toHaveBeenCalledTimes(2)
  })

  it("isolates a per-record failure: records it, does NOT mark it done, and keeps processing later records", async () => {
    const records = [record("a"), record("poison"), record("c")]
    const importOne = vi.fn().mockImplementation(async (r: GhlContactRecord) => {
      if (r.id === "poison") throw new Error("boom: malformed identifier")
      return outcome("created")
    })
    const onProgress = vi.fn()

    const result = await processGhlRecords(records, new Set(), importOne, onProgress)

    expect(importOne).toHaveBeenCalledTimes(3) // the loop did not stop at "poison"
    expect(result.failures).toEqual([{ ghlId: "poison", error: "boom: malformed identifier" }])
    expect(result.doneIds).toEqual(new Set(["a", "c"])) // "poison" is retryable, not marked done
    expect(result.processedThisRun).toBe(2)
    expect(result.counts.created).toBe(2)
    expect(onProgress).toHaveBeenCalledTimes(2) // never called for the failed record
  })

  it("stringifies a non-Error throw instead of losing the failure reason", async () => {
    const importOne = vi.fn().mockRejectedValue("a plain string rejection")
    const result = await processGhlRecords([record("x")], new Set(), importOne, vi.fn())

    expect(result.failures).toEqual([{ ghlId: "x", error: "a plain string rejection" }])
  })

  it("skips a record already marked done without calling the importer for it", async () => {
    const records = [record("already-done"), record("fresh")]
    const importOne = vi.fn().mockResolvedValue(outcome("created"))
    const onProgress = vi.fn()

    const result = await processGhlRecords(records, new Set(["already-done"]), importOne, onProgress)

    expect(importOne).toHaveBeenCalledTimes(1)
    expect(importOne).toHaveBeenCalledWith(expect.objectContaining({ id: "fresh" }))
    expect(result.skippedAlreadyDone).toBe(1)
    expect(result.processedThisRun).toBe(1)
    expect(result.doneIds).toEqual(new Set(["already-done", "fresh"]))
  })

  it("a run that is entirely failures reports zero processed and the full failure list, still returning normally", async () => {
    const records = [record("a"), record("b")]
    const importOne = vi.fn().mockRejectedValue(new Error("db unreachable"))

    const result = await processGhlRecords(records, new Set(), importOne, vi.fn())

    expect(result.processedThisRun).toBe(0)
    expect(result.doneIds).toEqual(new Set())
    expect(result.failures).toEqual([
      { ghlId: "a", error: "db unreachable" },
      { ghlId: "b", error: "db unreachable" },
    ])
  })
})
