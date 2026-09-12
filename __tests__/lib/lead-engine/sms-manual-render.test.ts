import { describe, it, expect } from "vitest"
import { countSmsSegments, renderManualSms, SMS_OPT_OUT_SENTENCE } from "@/lib/lead-engine/sms"

describe("countSmsSegments", () => {
  it("counts a plain message as one GSM-7 segment", () => {
    expect(countSmsSegments("Hey Jane, see you at 4pm.")).toMatchObject({
      encoding: "GSM-7", segments: 1, perSegment: 160,
    })
  })

  it("fits exactly 160 GSM-7 characters in one segment", () => {
    const out = countSmsSegments("a".repeat(160))
    expect(out).toMatchObject({ segments: 1, characters: 160 })
  })

  it("splits at 161 into two segments of 153", () => {
    expect(countSmsSegments("a".repeat(161))).toMatchObject({ segments: 2, perSegment: 153 })
  })

  it("flips the WHOLE message to UCS-2 on one curly apostrophe", () => {
    // The trap: a single non-GSM character re-encodes everything, so a
    // 100-char message that was one segment becomes two.
    const body = "a".repeat(99) + "’"
    expect(countSmsSegments(body)).toMatchObject({ encoding: "UCS-2", segments: 2, perSegment: 67 })
  })

  it("flips to UCS-2 on an emoji and counts it as a surrogate pair", () => {
    const out = countSmsSegments("hi \u{1F44B}")
    expect(out.encoding).toBe("UCS-2")
    // The emoji is two UTF-16 code units, so 3 + 2 = 5.
    expect(out.characters).toBe(5)
  })

  it("charges GSM-7 extension characters two septets", () => {
    // 80 euro signs = 160 septets = still one segment; 81 would not be.
    expect(countSmsSegments("€".repeat(80))).toMatchObject({ encoding: "GSM-7", segments: 1 })
    expect(countSmsSegments("€".repeat(81))).toMatchObject({ encoding: "GSM-7", segments: 2 })
  })

  it("treats an empty message as zero segments", () => {
    expect(countSmsSegments("")).toMatchObject({ segments: 0, characters: 0 })
  })

  it("uses 153 (not 160) as the GSM-7 concatenated divisor at a length only the smaller divisor pushes into a third segment", () => {
    // 307 chars is 3 segments at 153/segment but only 2 at 160/segment — a
    // boundary the 161-char case above can't distinguish, since both
    // divisors agree on 2 segments there.
    expect(countSmsSegments("a".repeat(307))).toMatchObject({ segments: 3, perSegment: 153 })
  })

  it("uses 67 (not 70) as the UCS-2 concatenated divisor at a length only the smaller divisor pushes into a third segment", () => {
    // 135 UCS-2 units is 3 segments at 67/segment but only 2 at 70/segment.
    const body = "a".repeat(134) + "’"
    expect(countSmsSegments(body)).toMatchObject({ segments: 3, perSegment: 67 })
  })
})

describe("renderManualSms", () => {
  it("appends the opt-out sentence on its own line when asked", () => {
    const { text } = renderManualSms({ body: "Hey Jane", appendOptOut: true })
    expect(text).toBe(`Hey Jane\n\n${SMS_OPT_OUT_SENTENCE}`)
  })

  it("sends the body alone when not asked", () => {
    const { text } = renderManualSms({ body: "Hey Jane", appendOptOut: false })
    expect(text).toBe("Hey Jane")
    expect(text).not.toContain("STOP")
  })

  it("trims trailing whitespace so the opt-out line never doubles up", () => {
    const { text } = renderManualSms({ body: "Hey Jane  \n\n", appendOptOut: true })
    expect(text).toBe(`Hey Jane\n\n${SMS_OPT_OUT_SENTENCE}`)
  })

  it("does not substitute templates — a manual message is typed, not rendered", () => {
    const { text } = renderManualSms({ body: "Use code {{name}}", appendOptOut: false })
    expect(text).toBe("Use code {{name}}")
  })
})
