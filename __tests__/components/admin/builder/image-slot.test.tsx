// @vitest-environment jsdom
// The media picker. Two things here can produce a page that looks fine and is
// broken, and both are what these cover:
//
//   - `heroMediaSchema` requires positive integer `w`/`h`. A media object
//     without them is refused by `applyOps` AFTER the owner has picked a photo,
//     with an error naming a field no UI ever showed them.
//   - a YouTube `src` must be a BARE ID. A full URL compiles perfectly cleanly
//     and renders YouTube's "video unavailable" frame — a broken embed with
//     zero compiler signal.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ImageSlotDialog, youtubeIdFrom, type HeroMedia } from "@/components/admin/funnels/builder/ImageSlotDialog"

const onChoose = vi.fn()
const onClose = vi.fn()
const onRemove = vi.fn()

function mount(current: HeroMedia | null = null) {
  return render(
    <ImageSlotDialog
      open
      stepId="s1"
      current={current}
      onClose={onClose}
      onChoose={onChoose}
      onRemove={onRemove}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("youtubeIdFrom", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("extracts the id from %s", (input, expected) => {
    expect(youtubeIdFrom(input)).toBe(expected)
  })

  it.each(["", "   ", "https://vimeo.com/12345", "not a link", "https://example.com/watch?v="])(
    "refuses %s rather than guessing",
    (input) => {
      expect(youtubeIdFrom(input)).toBeNull()
    },
  )

  it("only ever returns something the renderer will accept", () => {
    // render.ts gates on this exact shape and degrades to a grey placeholder
    // otherwise, so anything that escapes here becomes an unexplained box.
    const id = youtubeIdFrom("https://youtu.be/dQw4w9WgXcQ")
    expect(id).toMatch(/^[A-Za-z0-9_-]{6,20}$/)
  })
})

describe("ImageSlotDialog", () => {
  it("turns a pasted YouTube link into a bare id with a 16:9 ratio", () => {
    mount()
    fireEvent.change(screen.getByLabelText(/youtube link/i), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^use$/i }))

    expect(onChoose).toHaveBeenCalledWith({
      kind: "youtube",
      src: "dQw4w9WgXcQ",
      alt: "",
      w: 16,
      h: 9,
    })
  })

  it("says so rather than committing a link it cannot read", () => {
    // MUTANT KILLED: passing the raw string through. It would compile clean and
    // render "video unavailable" on the live page.
    mount()
    fireEvent.change(screen.getByLabelText(/youtube link/i), {
      target: { value: "https://vimeo.com/12345" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^use$/i }))

    expect(onChoose).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent(/youtube/i)
  })

  it("carries the alt text the owner typed", () => {
    mount()
    fireEvent.change(screen.getByLabelText(/screen readers/i), { target: { value: "Sprinting" } })
    fireEvent.change(screen.getByLabelText(/youtube link/i), { target: { value: "dQw4w9WgXcQ" } })
    fireEvent.click(screen.getByRole("button", { name: /^use$/i }))

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ alt: "Sprinting" }))
  })

  it("offers Remove only when the slot already holds something", () => {
    mount()
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument()

    onChoose.mockClear()
    mount({ kind: "image", src: "https://x/a.jpg", alt: "a", w: 10, h: 10 })
    expect(screen.getAllByRole("button", { name: /remove/i }).length).toBeGreaterThan(0)
  })

  it("sends the measured dimensions with the upload, and uses what comes back", async () => {
    // The whole reason the browser measures: heroMediaSchema demands positive
    // integers, and the server refuses an upload without them.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://firebasestorage.googleapis.com/v0/b/b/o/x?alt=media", width: 1200, height: 800 }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    // jsdom does not decode images, so `measure` resolves via onload only if we
    // drive it. Stub the intrinsic size the decoder would have produced.
    class StubImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 1200
      naturalHeight = 800
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal("Image", StubImage)
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()

    mount()
    const file = new File([new Uint8Array([1, 2, 3])], "hero.jpg", { type: "image/jpeg" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onChoose).toHaveBeenCalled())

    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get("width")).toBe("1200")
    expect(body.get("height")).toBe("800")
    expect(body.get("stepId")).toBe("s1")

    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image", w: 1200, h: 800 }),
    )
    vi.unstubAllGlobals()
  })

  it("reports a refused upload instead of failing silently", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "That image is over the 5 MB limit." }),
    })) as unknown as typeof fetch

    class StubImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 10
      naturalHeight = 10
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal("Image", StubImage)
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()

    mount()
    const file = new File([new Uint8Array([1])], "big.jpg", { type: "image/jpeg" })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    })

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/5 MB/i))
    expect(onChoose).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
