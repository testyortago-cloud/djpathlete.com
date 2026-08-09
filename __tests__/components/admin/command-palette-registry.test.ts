import { describe, expect, it } from "vitest"
import { getCommandPaletteItems, searchCommandPaletteItems } from "@/components/admin/command-palette/registry"
import type { PermissionActor } from "@/lib/permissions/registry"

describe("getCommandPaletteItems", () => {
  it("has no duplicate hrefs", () => {
    const items = getCommandPaletteItems({ contentStudioEnabled: false })
    const hrefs = items.map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it("includes both sidebar nav items and extra unlisted routes", () => {
    const items = getCommandPaletteItems({ contentStudioEnabled: false })
    const hrefs = items.map((i) => i.href)
    expect(hrefs).toContain("/admin/clients") // sidebar nav
    expect(hrefs).toContain("/admin/insights/client-risk") // extra route, not in sidebar
  })

  it("drops owner-only extra routes for a staff actor without the permission", () => {
    const staff: PermissionActor = { role: "staff", permissions: { clients: true } }
    const items = getCommandPaletteItems({ contentStudioEnabled: false, actor: staff })
    const hrefs = items.map((i) => i.href)
    expect(hrefs).not.toContain("/admin/settings") // owner-only
    expect(hrefs).not.toContain("/admin/automation") // owner-only
    expect(hrefs).toContain("/admin/clients") // actor has this permission
  })

  it("keeps everything for an admin actor", () => {
    const admin: PermissionActor = { role: "admin", permissions: {} }
    const items = getCommandPaletteItems({ contentStudioEnabled: false, actor: admin })
    expect(items.map((i) => i.href)).toContain("/admin/settings")
  })
})

describe("searchCommandPaletteItems", () => {
  const items = getCommandPaletteItems({ contentStudioEnabled: false })

  it("returns everything unranked for an empty query", () => {
    expect(searchCommandPaletteItems(items, "")).toEqual(items)
    expect(searchCommandPaletteItems(items, "   ")).toEqual(items)
  })

  it("surfaces Clients for a natural-language create request, excluding items that only match one word", () => {
    const results = searchCommandPaletteItems(items, "create a client")
    expect(results[0]?.href).toBe("/admin/clients")
    // Programs also has "create" in its keywords but nothing about "client" -
    // AND semantics across words should keep it out of these results.
    expect(results.find((i) => i.href === "/admin/programs")).toBeUndefined()
  })

  it("surfaces Clients for 'add athlete' via a synonym, not a literal label match", () => {
    const results = searchCommandPaletteItems(items, "add athlete")
    expect(results[0]?.href).toBe("/admin/clients")
  })

  it("matches on literal label text too", () => {
    const results = searchCommandPaletteItems(items, "exercises")
    expect(results[0]?.href).toBe("/admin/exercises")
  })

  it("is case-insensitive", () => {
    const lower = searchCommandPaletteItems(items, "create a client")
    const upper = searchCommandPaletteItems(items, "CREATE A CLIENT")
    expect(upper.map((i) => i.href)).toEqual(lower.map((i) => i.href))
  })

  it("ignores filler words like 'a' and 'the'", () => {
    const results = searchCommandPaletteItems(items, "create the client")
    expect(results[0]?.href).toBe("/admin/clients")
  })

  it("falls back to a looser match instead of going blank on an uncurated word", () => {
    // "widget" matches nothing anywhere; strict AND with "program" would be empty,
    // so the fallback pass should still surface Programs on the "program" word alone.
    const results = searchCommandPaletteItems(items, "widget program")
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((i) => i.href === "/admin/programs")).toBe(true)
  })

  it("returns an empty array when nothing matches at all", () => {
    const results = searchCommandPaletteItems(items, "xyzzy plugh qwerty")
    expect(results).toEqual([])
  })

  it("matches a multi-word keyword phrase ('chart of accounts')", () => {
    const results = searchCommandPaletteItems(items, "chart of accounts")
    expect(results[0]?.href).toBe("/admin/books/accounts")
  })
})
