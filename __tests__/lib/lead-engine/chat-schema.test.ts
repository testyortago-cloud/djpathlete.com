// @vitest-environment node
// __tests__/lib/lead-engine/chat-schema.test.ts
//
// Reads the migration off disk and asserts its shape. Mirrors
// __tests__/lib/lead-engine/pipeline-schema.test.ts, which exists because a
// migration is the one artifact no unit test otherwise touches — the DAL can
// be green against a schema that was never written the way the spec says.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §3
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const SQL = readFileSync("supabase/migrations/00227_lead_engine_chat.sql", "utf8")

describe("00227 chat tables", () => {
  it("creates both tables with a business_id defaulting to the singleton", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.chat_conversations/)
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.chat_messages/)
    const defaults = SQL.match(/business_id\s+uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'/g)
    expect(defaults).toHaveLength(2)
  })

  it("stores a hashed IP, never a raw one", () => {
    expect(SQL).toMatch(/ip_hash\s+text NOT NULL/)
    expect(SQL).not.toMatch(/\bip_address\b/)
  })

  it("keeps the fact set beside the reply so a blocked turn can be explained later", () => {
    expect(SQL).toMatch(/fact_set\s+jsonb NOT NULL DEFAULT '\{\}'::jsonb/)
    expect(SQL).toMatch(/violations\s+jsonb NOT NULL DEFAULT '\[\]'::jsonb/)
    expect(SQL).toMatch(/verdict\s+text[\s\S]{0,120}CHECK[\s\S]{0,120}'short_circuit'/)
  })

  it("indexes the two reads that are not by primary key", () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation/)
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_chat_conversations_ip/)
  })

  it("cascades messages with their conversation", () => {
    expect(SQL).toMatch(/conversation_id[\s\S]{0,120}REFERENCES public\.chat_conversations\(id\) ON DELETE CASCADE/)
  })
})

describe("00227 closes the tables to the public key", () => {
  // THE DEFECT THIS EXISTS FOR. The migration shipped without RLS, and Supabase
  // grants `anon` full DML on a public-schema table whose RLS is off. Measured
  // on the dev clone at the time: the anon key — which ships inside the browser
  // bundle — returned all 7 conversations and all 34 messages, and an INSERT
  // was accepted. Every sibling lead-engine migration (00212/00213/00214/00215)
  // enables RLS; 00227 was the outlier, in the one place holding what strangers
  // typed into a public box.
  //
  // This suite asserted five structural properties and no privilege boundary,
  // which is why nothing caught it. A schema test that never asks "who can read
  // this" is only half a schema test.
  it("enables row level security on both tables", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.chat_conversations\s+ENABLE ROW LEVEL SECURITY/)
    expect(SQL).toMatch(/ALTER TABLE public\.chat_messages\s+ENABLE ROW LEVEL SECURITY/)
  })

  it("grants the service role and nobody else", () => {
    const policies = SQL.match(/CREATE POLICY/g) ?? []
    expect(policies).toHaveLength(2)
    // Exactly two policies, both service_role. A policy granted TO anon or
    // TO authenticated here would re-open what the ALTERs above just closed,
    // and counting them is what stops a third one being added quietly.
    const toRoles = [...SQL.matchAll(/CREATE POLICY[\s\S]*?FOR ALL TO (\w+)/g)].map((m) => m[1])
    expect(toRoles).toEqual(["service_role", "service_role"])
  })
})
