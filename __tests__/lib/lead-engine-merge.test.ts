// @vitest-environment node
import { describe, it, expect } from "vitest"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"

const older: MatchCandidate = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "marissa@example.com",
  phone_e164: null,
  created_at: "2026-01-01T00:00:00Z",
}
const newer: MatchCandidate = {
  id: "22222222-2222-2222-2222-222222222222",
  email: null,
  phone_e164: "+16176504548",
  created_at: "2026-06-01T00:00:00Z",
}

describe("decideMerge", () => {
  it("creates when nothing matches", () => {
    expect(decideMerge([], "new@example.com", null)).toEqual({ kind: "create" })
  })

  it("updates when only the email matches", () => {
    expect(decideMerge([older], "marissa@example.com", null)).toEqual({
      kind: "update",
      contactId: older.id,
    })
  })

  it("updates when only the phone matches", () => {
    expect(decideMerge([newer], null, "+16176504548")).toEqual({
      kind: "update",
      contactId: newer.id,
    })
  })

  it("merges when email and phone point at different contacts, oldest surviving", () => {
    expect(decideMerge([older, newer], "marissa@example.com", "+16176504548")).toEqual({
      kind: "merge",
      survivorId: older.id,
      mergedId: newer.id,
    })
  })

  it("merges the same way regardless of candidate order", () => {
    expect(decideMerge([newer, older], "marissa@example.com", "+16176504548")).toEqual({
      kind: "merge",
      survivorId: older.id,
      mergedId: newer.id,
    })
  })

  it("updates, not merges, when both identifiers point at the same contact", () => {
    const both: MatchCandidate = { ...older, phone_e164: "+16176504548" }
    expect(decideMerge([both], "marissa@example.com", "+16176504548")).toEqual({
      kind: "update",
      contactId: both.id,
    })
  })

  it("ignores a candidate that matches neither identifier", () => {
    const unrelated: MatchCandidate = {
      id: "33333333-3333-3333-3333-333333333333",
      email: "someone@else.com",
      phone_e164: null,
      created_at: "2025-01-01T00:00:00Z",
    }
    expect(decideMerge([unrelated], "new@example.com", null)).toEqual({ kind: "create" })
  })

  it("matches email case-insensitively", () => {
    expect(decideMerge([older], "MARISSA@EXAMPLE.COM", null)).toEqual({
      kind: "update",
      contactId: older.id,
    })
  })

  it("does not treat two phone-only contacts as the same person (null email guard)", () => {
    const phoneOnly: MatchCandidate = {
      id: "44444444-4444-4444-4444-444444444444",
      email: null,
      phone_e164: "+12025551234",
      created_at: "2026-02-01T00:00:00Z",
    }
    expect(decideMerge([phoneOnly], null, "+16176504548")).toEqual({ kind: "create" })
  })

  it("uses id tiebreaker when created_at is identical, smaller id survives", () => {
    const sameTime1: MatchCandidate = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "test@example.com",
      phone_e164: null,
      created_at: "2026-03-01T00:00:00Z",
    }
    const sameTime2: MatchCandidate = {
      id: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      email: null,
      phone_e164: "+11234567890",
      created_at: "2026-03-01T00:00:00Z",
    }
    expect(decideMerge([sameTime1, sameTime2], "test@example.com", "+11234567890")).toEqual({
      kind: "merge",
      survivorId: sameTime1.id,
      mergedId: sameTime2.id,
    })
  })

  it("uses id tiebreaker consistently regardless of order when created_at is identical", () => {
    const sameTime1: MatchCandidate = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "test@example.com",
      phone_e164: null,
      created_at: "2026-03-01T00:00:00Z",
    }
    const sameTime2: MatchCandidate = {
      id: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      email: null,
      phone_e164: "+11234567890",
      created_at: "2026-03-01T00:00:00Z",
    }
    expect(decideMerge([sameTime2, sameTime1], "test@example.com", "+11234567890")).toEqual({
      kind: "merge",
      survivorId: sameTime1.id,
      mergedId: sameTime2.id,
    })
  })
})
