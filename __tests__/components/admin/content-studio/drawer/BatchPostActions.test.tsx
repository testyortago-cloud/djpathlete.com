// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { BatchPostActions, eligibleForBatch } from "@/components/admin/content-studio/drawer/BatchPostActions"
import type { SocialPost } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

const post = (id: string, o: Partial<SocialPost> = {}): SocialPost => ({
  id,
  platform: "instagram",
  content: `c-${id}`,
  media_url: null,
  post_type: "video",
  approval_status: "draft",
  scheduled_at: null,
  published_at: null,
  source_video_id: "v1",
  rejection_notes: null,
  platform_post_id: null,
  created_by: "u",
  created_at: "",
  updated_at: "",
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ approval_status: "approved", scheduled_at: null }), { status: 200 })),
  )
})

describe("eligibleForBatch", () => {
  it("excludes published and rejected posts", () => {
    const posts = [
      post("a", { approval_status: "draft" }),
      post("b", { approval_status: "published" }),
      post("c", { approval_status: "rejected" }),
      post("d", { approval_status: "approved" }),
    ]
    expect(eligibleForBatch(posts).map((p) => p.id)).toEqual(["a", "d"])
  })
})

describe("<BatchPostActions>", () => {
  it("shows Publish all + Schedule all, enabled, when ready", () => {
    render(<BatchPostActions posts={[post("a"), post("b")]} isReady onMutate={vi.fn()} />)
    expect(screen.getByRole("button", { name: /publish all/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /schedule all/i })).toBeEnabled()
  })

  it("disables the batch buttons when the video isn't ready", () => {
    render(<BatchPostActions posts={[post("a")]} isReady={false} onMutate={vi.fn()} />)
    expect(screen.getByRole("button", { name: /publish all/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /schedule all/i })).toBeDisabled()
  })

  it("renders nothing when there are no eligible posts", () => {
    const { container } = render(
      <BatchPostActions
        posts={[post("a", { approval_status: "published" })]}
        isReady
        onMutate={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("Publish all queues every eligible post via publish-now", async () => {
    const onMutate = vi.fn()
    render(
      <BatchPostActions
        posts={[post("a"), post("b", { approval_status: "published" }), post("c")]}
        isReady
        onMutate={onMutate}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /publish all/i }))
    })
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/admin/social/posts/a/publish-now", expect.objectContaining({ method: "POST" }))
      expect(fetch).toHaveBeenCalledWith("/api/admin/social/posts/c/publish-now", expect.objectContaining({ method: "POST" }))
    })
    // The published post "b" is not eligible — never queued.
    expect(fetch).not.toHaveBeenCalledWith("/api/admin/social/posts/b/publish-now", expect.anything())
    expect(onMutate).toHaveBeenCalledTimes(2)
  })
})
