// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { captureFrameFromElement, commitThumbnail, revertThumbnailToAuto } from "@/lib/firebase-client-thumbnail"

function fakeVideoElement(width = 1920, height = 1080): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height, currentTime: 12.5 } as HTMLVideoElement
}

describe("captureFrameFromElement", () => {
  let drawImage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    drawImage = vi.fn()
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag !== "canvas") return realCreateElement(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/jpeg" })),
      } as unknown as HTMLCanvasElement
    }) as typeof document.createElement)
  })

  afterEach(() => vi.restoreAllMocks())

  it("encodes the currently displayed frame without seeking", async () => {
    const el = fakeVideoElement()
    const blob = await captureFrameFromElement(el)
    expect(blob).toBeInstanceOf(Blob)
    // It must not move the playhead — the operator chose this frame.
    expect(el.currentTime).toBe(12.5)
    expect(drawImage).toHaveBeenCalled()
  })

  it("caps width at 480 and preserves aspect ratio", async () => {
    await captureFrameFromElement(fakeVideoElement(1920, 1080))
    const [, , , w, h] = drawImage.mock.calls[0] as [unknown, number, number, number, number]
    expect(w).toBe(480)
    expect(h).toBe(270)
  })

  it("returns null when the element has no dimensions yet", async () => {
    const blob = await captureFrameFromElement(fakeVideoElement(0, 0))
    expect(blob).toBeNull()
  })
})

describe("commitThumbnail", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("requests a path, PUTs the bytes, then commits the row", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url.endsWith("/thumbnail/custom")) {
        return new Response(JSON.stringify({ uploadUrl: "https://signed/put", thumbnailPath: "videos/a.mp4.thumb-custom-1.jpg" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    }))

    const ok = await commitThumbnail("v1", new Blob(["x"]), "frame")
    expect(ok).toBe(true)
    expect(calls).toEqual([
      "POST /api/admin/videos/v1/thumbnail/custom",
      "PUT https://signed/put",
      "PUT /api/admin/videos/v1/thumbnail",
    ])
  })

  it("does NOT commit the row when the bytes fail to upload", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (url.endsWith("/thumbnail/custom")) {
        return new Response(JSON.stringify({ uploadUrl: "https://signed/put", thumbnailPath: "p.jpg" }), { status: 200 })
      }
      if (url === "https://signed/put") return new Response("nope", { status: 403 })
      return new Response("{}", { status: 200 })
    }))

    const ok = await commitThumbnail("v1", new Blob(["x"]), "frame")
    expect(ok).toBe(false)
    expect(calls).not.toContain("PUT /api/admin/videos/v1/thumbnail")
  })
})

describe("revertThumbnailToAuto", () => {
  it("sends source=auto and no thumbnailPath", async () => {
    let body: unknown
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response("{}", { status: 200 })
    }))
    const ok = await revertThumbnailToAuto("v1")
    expect(ok).toBe(true)
    expect(body).toEqual({ source: "auto" })
  })

  it("returns false when the auto blob is gone (409)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "gone" }), { status: 409 })))
    expect(await revertThumbnailToAuto("v1")).toBe(false)
  })
})
