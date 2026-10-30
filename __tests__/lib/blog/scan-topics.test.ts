import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  MAX_SCAN_SEARCHES,
  nextMondayISO,
  scanQueriesFrom,
  searchCountProblem,
  searchesFor,
  topicsFromQueries,
  withTopicAdded,
  type ScanTopic,
} from "@/lib/blog/scan-topics"
import { DEFAULT_BLOG_SCAN_QUERIES } from "@/lib/blog/scan-queries"

const topic = (name: string, extra: Partial<ScanTopic> = {}): ScanTopic => ({
  id: name,
  name,
  keywords: [],
  active: true,
  ...extra,
})

describe("searchesFor", () => {
  it("searches a topic with no keywords by its name, exactly as a line was searched before", () => {
    expect(searchesFor(topic("sprint acceleration speed mechanics development research"))).toEqual([
      "sprint acceleration speed mechanics development research",
    ])
  })

  it("searches once per keyword, adding 'research' unless the name already says it", () => {
    expect(searchesFor(topic("Agility", { keywords: ["deceleration", " cutting mechanics "] }))).toEqual([
      "Agility deceleration research",
      "Agility cutting mechanics research",
    ])
    expect(searchesFor(topic("agility research", { keywords: ["deceleration"] }))).toEqual([
      "agility research deceleration",
    ])
  })
})

describe("scanQueriesFrom", () => {
  it("leaves out the topics switched off, and repeats no search", () => {
    const topics = [topic("Agility"), topic("Energy systems", { active: false }), topic("agility ")]
    expect(scanQueriesFrom(topics)).toEqual(["Agility", "agility"])
    expect(scanQueriesFrom([topic("Agility"), topic("Agility")])).toEqual(["Agility"])
  })
})

describe("searchCountProblem", () => {
  it("refuses everything off: the scan would fall back to its built-in list", () => {
    expect(searchCountProblem([topic("Agility", { active: false })])).toMatch(/at least one/)
  })

  it("refuses more searches than the scan runs, counting keywords", () => {
    const many = [topic("Speed", { keywords: Array.from({ length: 8 }, (_, i) => `k${i}`) })]
    const twenty = [...many, topic("Power", { keywords: Array.from({ length: 8 }, (_, i) => `p${i}`) })]
    const over = [...twenty, topic("Strength", { keywords: ["a1", "a2", "a3", "a4", "a5"] })]
    expect(scanQueriesFrom(over)).toHaveLength(21)
    expect(searchCountProblem(over)).toMatch(/21 searches/)
    expect(searchCountProblem([...twenty, topic("Strength", { keywords: ["a1", "a2", "a3", "a4"] })])).toBeNull()
  })
})

describe("topicsFromQueries", () => {
  it("turns the old list into one box per line, all on, searching what it searched before", () => {
    const topics = topicsFromQueries(DEFAULT_BLOG_SCAN_QUERIES)
    expect(topics.every((t) => t.active && t.keywords.length === 0)).toBe(true)
    expect(scanQueriesFrom(topics)).toEqual(DEFAULT_BLOG_SCAN_QUERIES)
  })
})

describe("withTopicAdded", () => {
  it("adds a researched subject switched on, marked as from research", () => {
    const { topics, result } = withTopicAdded([topic("Agility")], "Rotational power for golfers", "research")
    expect(result).toBe("on")
    expect(topics[1]).toMatchObject({ name: "Rotational power for golfers", active: true, origin: "research" })
  })

  it("switches an existing topic of the same name back on instead of adding it twice", () => {
    const { topics, result } = withTopicAdded([topic("Energy systems", { active: false })], " energy SYSTEMS", "manual")
    expect(result).toBe("on")
    expect(topics).toEqual([topic("Energy systems")])
  })

  it("adds it switched off when the searches are used up, so the add itself never fails", () => {
    const full = Array.from({ length: MAX_SCAN_SEARCHES }, (_, i) => topic(`Topic ${i}`))
    const { topics, result } = withTopicAdded(full, "One more", "manual")
    expect(result).toBe("off")
    expect(topics.at(-1)).toMatchObject({ name: "One more", active: false })
    expect(searchCountProblem(topics)).toBeNull()
  })
})

describe("nextMondayISO", () => {
  it("is the Monday the weekly scan dates its cards with", () => {
    expect(nextMondayISO(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-09") // the scan's own Monday run
    expect(nextMondayISO(new Date("2026-11-03T12:00:00Z"))).toBe("2026-11-09")
    expect(nextMondayISO(new Date("2026-11-08T23:00:00Z"))).toBe("2026-11-09")
  })

  it("matches its twin in the Firebase scan", () => {
    const fn = readFileSync("functions/src/tavily-trending-scan.ts", "utf8")
    expect(fn).toContain("const daysUntilMonday = day === 0 ? 1 : 8 - day")
  })
})

describe("DEFAULT_BLOG_SCAN_QUERIES", () => {
  it("is the same list as TRENDING_QUERIES in the Firebase scan (its fallback)", () => {
    const fn = readFileSync("functions/src/tavily-trending-scan.ts", "utf8")
    const block = fn.match(/TRENDING_QUERIES[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? ""
    const twin = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(twin).toEqual(DEFAULT_BLOG_SCAN_QUERIES)
  })
})
