// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CommentThread } from "@/components/shared/CommentThread"

// Sonner toasts (used by the Reply composer if it ever opens) — stub so we
// don't see warnings in stderr if the component reaches into them.
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

describe("CommentThread image_index pill", () => {
  it("renders 'Image N' pill and calls onJumpToImage on click", () => {
    const onJump = vi.fn()
    render(
      <CommentThread
        comments={[
          {
            id: "c1",
            submission_id: "s1",
            version_id: "v1",
            parent_id: null,
            author_id: "u1",
            comment_text: "Crop too tight",
            timecode_seconds: null,
            status: "open",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolved_at: null,
            resolved_by: null,
            annotation: { kind: "image_index", index: 2 },
            author: null,
            version_number: 1,
            // Cast to never to bypass any drift between the runtime payload
            // we mount here and the full Supabase row shape.
          } as never,
        ]}
        canWrite={false}
        onJumpToImage={onJump}
      />,
    )

    // Pill renders as "Image 3" for index=2 (display is 1-based).
    const pill = screen.getByRole("button", { name: /Image 3/i })
    expect(pill).toBeInTheDocument()
    fireEvent.click(pill)
    expect(onJump).toHaveBeenCalledWith(2)
  })

  it("does not crash when image_index annotation is present without onJumpToImage", () => {
    render(
      <CommentThread
        comments={[
          {
            id: "c2",
            submission_id: "s1",
            version_id: "v1",
            parent_id: null,
            author_id: "u1",
            comment_text: "Looks good",
            timecode_seconds: null,
            status: "open",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolved_at: null,
            resolved_by: null,
            annotation: { kind: "image_index", index: 0 },
            author: null,
            version_number: 1,
          } as never,
        ]}
        canWrite={false}
      />,
    )

    // Pill still renders — index=0 → "Image 1". Clicking is a no-op.
    const pill = screen.getByRole("button", { name: /Image 1/i })
    fireEvent.click(pill)
    expect(pill).toBeInTheDocument()
  })

  it("renders the existing timecode for drawing annotations (no Image pill)", () => {
    render(
      <CommentThread
        comments={[
          {
            id: "c3",
            submission_id: "s1",
            version_id: "v1",
            parent_id: null,
            author_id: "u1",
            comment_text: "Cut here",
            timecode_seconds: 24,
            status: "open",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolved_at: null,
            resolved_by: null,
            annotation: {
              paths: [
                {
                  tool: "pin",
                  color: "#FF3B30",
                  width: 4,
                  points: [[0.5, 0.5]],
                },
              ],
            },
            author: null,
            version_number: 1,
          } as never,
        ]}
        canWrite={false}
      />,
    )

    // 0:24 timecode label is present; no "Image N" button rendered.
    expect(screen.getByText("0:24")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Image \d+/i })).toBeNull()
  })
})
