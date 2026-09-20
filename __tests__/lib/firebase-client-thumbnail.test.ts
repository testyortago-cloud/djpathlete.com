// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  captureFrameFromElement,
  captureFrameFromUrlAt,
  commitThumbnail,
  revertThumbnailToAuto,
} from "@/lib/firebase-client-thumbnail"

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

// Minimal stand-in for the offscreen <video> element captureFrame() builds
// internally. Exposes just enough (event registration, the settable
// properties captureFrame reads/writes, and no-op cleanup methods) to drive
// the loadedmetadata → seeked flow by hand from a test.
function fakeOffscreenVideo(duration: number) {
  const listeners: Record<string, Array<() => void>> = {}
  const el = {
    preload: "",
    muted: false,
    playsInline: false,
    crossOrigin: null as string | null,
    src: "",
    duration,
    videoWidth: 640,
    videoHeight: 360,
    currentTime: 0,
    addEventListener(type: string, cb: () => void) {
      ;(listeners[type] ??= []).push(cb)
    },
    removeEventListener(type: string, cb: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb)
    },
    removeAttribute() {},
    load() {},
  } as unknown as HTMLVideoElement
  const fire = (type: string) => {
    for (const cb of listeners[type] ?? []) cb()
  }
  return { el, fire }
}

describe("captureFrameFromUrlAt", () => {
  let offscreen: ReturnType<typeof fakeOffscreenVideo>

  beforeEach(() => {
    offscreen = fakeOffscreenVideo(30)
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "video") return offscreen.el
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/jpeg" })),
        } as unknown as HTMLCanvasElement
      }
      return realCreateElement(tag)
    }) as typeof document.createElement)
  })

  afterEach(() => vi.restoreAllMocks())

  it("sets crossOrigin=anonymous on the offscreen element", async () => {
    const promise = captureFrameFromUrlAt("https://storage.googleapis.com/bucket/v.mp4", 5)
    expect(offscreen.el.crossOrigin).toBe("anonymous")
    offscreen.fire("loadedmetadata")
    offscreen.fire("seeked")
    await promise
  })

  it("seeks to the requested time, not the fixed 1.0s auto-thumbnail target", async () => {
    const promise = captureFrameFromUrlAt("https://storage.googleapis.com/bucket/v.mp4", 12.5)
    offscreen.fire("loadedmetadata")
    expect(offscreen.el.currentTime).toBe(12.5)
    offscreen.fire("seeked")
    await promise
  })

  it("clamps a requested time beyond the video's duration", async () => {
    // duration is 30 (see fakeOffscreenVideo default above).
    const promise = captureFrameFromUrlAt("https://storage.googleapis.com/bucket/v.mp4", 999)
    offscreen.fire("loadedmetadata")
    expect(offscreen.el.currentTime).toBe(30)
    offscreen.fire("seeked")
    await promise
  })

  it("resolves null when the element errors", async () => {
    const promise = captureFrameFromUrlAt("https://storage.googleapis.com/bucket/v.mp4", 5)
    offscreen.fire("error")
    await expect(promise).resolves.toBeNull()
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
