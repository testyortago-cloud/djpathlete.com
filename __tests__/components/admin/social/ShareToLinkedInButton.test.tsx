// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const jobState: { status: string; error: string | null; result: unknown } = {
  status: "pending",
  error: null,
  result: null,
}
const useAiJobMock = vi.fn((_id: string | null) => jobState)
vi.mock("@/hooks/use-ai-job", () => ({ useAiJob: (id: string | null) => useAiJobMock(id) }))

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))

import { ShareToLinkedInButton } from "@/components/admin/social/ShareToLinkedInButton"

// The two shapes POST /api/admin/social/share returns in `review`, one per CONTENT_STUDIO_ENABLED state.
const STUDIO_REVIEW = { label: "Content Studio", listHref: "/admin/content?tab=posts", postHrefPrefix: "/admin/content/post/" }
const SOCIAL_REVIEW = { label: "Social", listHref: "/admin/social", postHrefPrefix: null }

function reply(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) })
}

describe("ShareToLinkedInButton", () => {
  beforeEach(() => {
    toastError.mockClear()
    useAiJobMock.mockClear()
    jobState.status = "pending"
    jobState.error = null
    jobState.result = null
  })

  it("renders an idle button", () => {
    render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    expect(screen.getByRole("button", { name: "Share to LinkedIn" })).toBeTruthy()
  })

  it("posts the source and is disabled while the request is pending", async () => {
    let resolve!: (v: unknown) => void
    const fetchMock = vi.fn(() => new Promise((r) => (resolve = r)))
    vi.stubGlobal("fetch", fetchMock)
    render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    const btn = screen.getByRole("button", { name: "Share to LinkedIn" }) as HTMLButtonElement
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/social/share",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ blogPostId: "b1" }) }),
    )
    expect(btn.disabled).toBe(true)
    resolve(await reply(409, { error: "x" }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })

  async function completeJob(review: unknown, result: unknown) {
    vi.stubGlobal("fetch", vi.fn(() => reply(202, { jobId: "j1", review })))
    const { rerender } = render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    await screen.findByRole("button", { name: "Writing LinkedIn post…" })
    expect(useAiJobMock).toHaveBeenLastCalledWith("j1")
    jobState.status = "completed"
    jobState.result = result
    rerender(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
  }

  it("shows writing, then deep-links to the new draft in the Content Studio", async () => {
    await completeJob(STUDIO_REVIEW, { platforms: [{ platform: "linkedin", social_post_id: "p1" }] })
    const link = await screen.findByRole("link", { name: "Draft ready → review in Content Studio" })
    expect(link.getAttribute("href")).toBe("/admin/content/post/p1")
  })

  it("falls back to the Content Studio's post list when the job names no post", async () => {
    await completeJob(STUDIO_REVIEW, { platforms: [] })
    const link = await screen.findByRole("link", { name: "Draft ready → review in Content Studio" })
    expect(link.getAttribute("href")).toBe("/admin/content?tab=posts")
  })

  it("links to the Social page when the Content Studio is off", async () => {
    await completeJob(SOCIAL_REVIEW, { platforms: [{ platform: "linkedin", social_post_id: "p1" }] })
    const link = await screen.findByRole("link", { name: "Draft ready → review in Social" })
    expect(link.getAttribute("href")).toBe("/admin/social")
  })

  it("deep-links to the existing draft in the Content Studio, without a job", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(200, { existingPostId: "p9", review: STUDIO_REVIEW })))
    render(<ShareToLinkedInButton source={{ newsletterId: "n1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    const link = await screen.findByRole("link", { name: "Draft already in Content Studio" })
    expect(link.getAttribute("href")).toBe("/admin/content/post/p9")
    for (const call of useAiJobMock.mock.calls) expect(call[0]).toBeNull()
  })

  it("links to the Social page for an existing draft when the Content Studio is off", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(200, { existingPostId: "p9", review: SOCIAL_REVIEW })))
    render(<ShareToLinkedInButton source={{ newsletterId: "n1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    const link = await screen.findByRole("link", { name: "Draft already in Social" })
    expect(link.getAttribute("href")).toBe("/admin/social")
  })

  it("toasts the route's message on an error and goes back to idle", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(409, { error: "Connect LinkedIn first (Platform connections)" })))
    render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Connect LinkedIn first (Platform connections)"))
    expect((screen.getByRole("button", { name: "Share to LinkedIn" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("toasts a plain message when the job fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(202, { jobId: "j1" })))
    const { rerender } = render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    await screen.findByRole("button", { name: "Writing LinkedIn post…" })
    jobState.status = "failed"
    jobState.error = "All platforms failed: boom"
    rerender(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't write the LinkedIn post: All platforms failed: boom"),
    )
    await screen.findByRole("button", { name: "Share to LinkedIn" })
  })

  it("toasts when the agent skipped the post", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(202, { jobId: "j1" })))
    const { rerender } = render(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Share to LinkedIn" }))
    await screen.findByRole("button", { name: "Writing LinkedIn post…" })
    jobState.status = "completed"
    jobState.result = { skipped: true }
    rerender(<ShareToLinkedInButton source={{ blogPostId: "b1" }} />)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The agent decided not to draft this one"))
    await screen.findByRole("button", { name: "Share to LinkedIn" })
  })
})
