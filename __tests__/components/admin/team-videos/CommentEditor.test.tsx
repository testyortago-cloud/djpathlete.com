// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CommentEditor } from "@/components/admin/team-videos/CommentEditor"

// Stub out next/navigation router.refresh() — CommentEditor calls it
// after a successful POST and the default vitest setup doesn't mount it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

// Sonner toasts spam stderr in unit tests; stub them.
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Each test asserts on a fresh fetch mock.
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }) as unknown as typeof fetch
})

describe("CommentEditor (image_set)", () => {
  it("sends annotation.kind=image_index when pinning to current image", async () => {
    render(
      <CommentEditor
        submissionId="sub1"
        currentImageIndex={2}
        submissionKind="image_set"
        getCurrentTimecode={() => null}
        onCreated={() => {}}
        drawing={null}
        onAfterSubmit={() => {}}
      />,
    )

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Crop is too tight" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Pin to current image/i }))
    fireEvent.click(screen.getByRole("button", { name: /Post comment/i }))

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
    })
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(body.annotation).toEqual({ kind: "image_index", index: 2 })
    expect(body.timecodeSeconds).toBeNull()
    expect(body.commentText).toBe("Crop is too tight")
  })

  it("omits the annotation when the pin toggle stays off", async () => {
    render(
      <CommentEditor
        submissionId="sub1"
        currentImageIndex={0}
        submissionKind="image_set"
        getCurrentTimecode={() => null}
        onCreated={() => {}}
        drawing={null}
        onAfterSubmit={() => {}}
      />,
    )

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Overall vibe is great" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Post comment/i }))

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
    })
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(body.annotation).toBeUndefined()
    expect(body.timecodeSeconds).toBeNull()
  })

  it("does not render the image-pin button when submissionKind is video", () => {
    render(
      <CommentEditor
        submissionId="sub1"
        submissionKind="video"
        getCurrentTimecode={() => 5}
        onCreated={() => {}}
        drawing={null}
        onAfterSubmit={() => {}}
      />,
    )
    expect(
      screen.queryByRole("button", { name: /Pin to current image/i }),
    ).toBeNull()
    // The video-mode general-comment checkbox is what's rendered instead.
    expect(screen.getByLabelText(/General comment/i)).toBeInTheDocument()
  })
})

describe("CommentEditor (video)", () => {
  it("sends the drawing annotation alongside the timecode when provided", async () => {
    const drawing = {
      paths: [
        {
          tool: "pin" as const,
          color: "#FF3B30",
          width: 4,
          points: [[0.5, 0.5]] as Array<[number, number]>,
        },
      ],
    }
    render(
      <CommentEditor
        submissionId="sub1"
        submissionKind="video"
        getCurrentTimecode={() => 12.4}
        onCreated={() => {}}
        drawing={drawing}
        onAfterSubmit={() => {}}
      />,
    )

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Cut this part" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Add comment/i }))

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
    })
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(body.annotation).toEqual(drawing)
    expect(body.timecodeSeconds).toBe(12.4)
  })
})
