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
