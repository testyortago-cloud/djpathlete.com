// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"

const SQL = readFileSync("supabase/migrations/00278_funnel_tenancy.sql", "utf8")

describe("00278 funnel tenancy", () => {
  it("adds business_id to all seven tables", () => {
    for (const t of [
      "funnels",
      "funnel_steps",
      "funnel_step_versions",
      "funnel_step_turns",
      "funnel_submissions",
      "funnel_checkout_grants",
      "lead_magnets",
    ]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t}\\s+add column business_id uuid not null`))
    }
  })

  it("REPLACES each simple FK rather than adding alongside it", () => {
    // MUTANT: delete a `drop constraint` line. PostgREST then sees two
    // relationships between funnel_submissions and funnels and answers
    // PGRST201, and the leads inbox renders empty with no error anyone sees.
    for (const c of [
      "funnel_steps_funnel_id_fkey",
      "funnel_step_versions_step_id_fkey",
      "funnel_step_turns_step_id_fkey",
      "funnel_submissions_funnel_id_fkey",
      "funnel_submissions_step_id_fkey",
    ]) {
      expect(SQL).toContain(`drop constraint ${c}`)
    }
  })

  it("carries ON DELETE CASCADE onto every replacement FK", () => {
    // MUTANT: drop the cascade on any one of them. deleteFunnel/deleteStep
    // then raise foreign_key_violation at runtime and nothing fails at build.
    const adds = SQL.match(/add constraint funnel_\w+_business_fkey[\s\S]*?;/g) ?? []
    expect(adds).toHaveLength(5)
    for (const a of adds) expect(a).toContain("on delete cascade")
  })

  it("scopes both slug indexes per tenant, preserving each one's case rule", () => {
    expect(SQL).toContain(
      "create unique index funnels_business_id_slug_key\n  on public.funnels (business_id, lower(slug))",
    )
    expect(SQL).toContain(
      "create unique index lead_magnets_business_id_slug_key\n  on public.lead_magnets (business_id, slug)",
    )
    expect(SQL).toContain("drop index if exists public.funnels_slug_key")
  })

  it("keeps the default, because the deploy window depends on it", () => {
    // MUTANT: add `alter column business_id drop default`. The currently
    // deployed bundle's inserts then fail 23502 for the length of the build.
    expect(SQL).not.toMatch(/drop default/)
    expect(SQL.match(/default '00000000-0000-0000-0000-000000000001'/g) ?? []).toHaveLength(7)
  })
})
