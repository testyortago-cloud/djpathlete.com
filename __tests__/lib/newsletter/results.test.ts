// @vitest-environment node
import { describe, it, expect } from "vitest"
import { pct, resultTiles, resultsLine } from "@/lib/newsletter/results"

// The 2026-10-09 issue, as the backfill rebuilt it on the dev clone.
const OCT_9 = {
  newsletter_id: "nl-1",
  recipients: 1200,
  delivered: 924,
  opened: 293,
  clicked: 40,
  bounced: 105,
  complained: 2,
}

describe("pct", () => {
  it("rounds to whole percents from 10 up, one decimal below, and drops a trailing .0", () => {
    expect(pct(293, 924)).toBe("32%")
    expect(pct(40, 924)).toBe("4.3%")
    expect(pct(105, 1200)).toBe("8.8%")
    expect(pct(4, 100)).toBe("4%")
    expect(pct(0, 100)).toBe("0%")
    expect(pct(996, 10000)).toBe("10%")
  })

  // A rate with nothing under it is not 0% and is never NaN%.
  it("has no rate when its base is 0", () => {
    expect(pct(0, 0)).toBeNull()
    expect(pct(3, 0)).toBeNull()
  })
})

describe("resultsLine", () => {
  it("summarises an issue in one line for the list", () => {
    expect(resultsLine(OCT_9)).toBe("Opened 32% · Clicked 4.3% · Bounced 8.8%")
  })

  it("leaves out a rate it cannot work out yet", () => {
    expect(resultsLine({ ...OCT_9, delivered: 0, opened: 0, clicked: 0 })).toBe("Bounced 8.8%")
  })

  it("says nothing for an issue with no results", () => {
    expect(resultsLine(undefined)).toBeNull()
    expect(
      resultsLine({ ...OCT_9, recipients: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }),
    ).toBeNull()
  })
})

describe("resultTiles", () => {
  it("lays out the six numbers with what each rate is out of", () => {
    expect(resultTiles(OCT_9)).toEqual([
      { label: "Sent", value: "1,200", detail: null },
      { label: "Delivered", value: "924", detail: "77% of sent" },
      { label: "Opened", value: "293", detail: "32% of delivered" },
      { label: "Clicked", value: "40", detail: "4.3% of delivered" },
      { label: "Bounced (the address does not exist)", value: "105", detail: "8.8% of sent" },
      { label: "Marked as spam", value: "2", detail: "0.2% of delivered" },
    ])
  })

  it("shows no rate under a number whose base is 0", () => {
    const tiles = resultTiles({ ...OCT_9, delivered: 0, opened: 0, clicked: 0, complained: 0 })
    expect(tiles.find((t) => t.label === "Opened")?.detail).toBeNull()
    expect(tiles.find((t) => t.label === "Delivered")?.detail).toBe("0% of sent")
  })
})
