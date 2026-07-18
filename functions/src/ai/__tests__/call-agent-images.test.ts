import { describe, it, expect } from "vitest"
import { buildUserContent } from "../anthropic.js"

describe("buildUserContent", () => {
  it("returns the bare string when no images/prefix", () => {
    expect(buildUserContent("hello", undefined, undefined)).toBe("hello")
  })
  it("prepends image blocks before the text", () => {
    const content = buildUserContent("read this receipt", undefined, [{ media_type: "image/jpeg", data: "AAAA" }])
    expect(Array.isArray(content)).toBe(true)
    const blocks = content as unknown as Array<Record<string, unknown>>
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } })
    expect(blocks[blocks.length - 1]).toEqual({ type: "text", text: "read this receipt" })
  })
  it("orders image, cached prefix, then text", () => {
    const content = buildUserContent("q", "CACHED", [{ media_type: "image/png", data: "B" }]) as unknown as Array<
      Record<string, unknown>
    >
    expect(content.map((b) => b.type)).toEqual(["image", "text", "text"])
    expect((content[1] as { text: string }).text).toBe("CACHED")
  })
})
