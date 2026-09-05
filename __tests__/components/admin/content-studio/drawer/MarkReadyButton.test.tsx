// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const refreshMock = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { MarkReadyButton } from "@/components/admin/content-studio/drawer/MarkReadyButton"
import { toast } from "sonner"

describe("MarkReadyButton", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the button when the video still needs editing", () => {
    render(<MarkReadyButton videoUploadId="v1" needsEdit />)
    expect(screen.getByRole("button", { name: /mark as ready/i })).toBeInTheDocument()
  })

  it("renders nothing when the video is already ready", () => {
    const { container } = render(<MarkReadyButton videoUploadId="v1" needsEdit={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("PATCHes the mark-ready endpoint, toasts success, and refreshes on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)

    render(<MarkReadyButton videoUploadId="v1" needsEdit />)
    fireEvent.click(screen.getByRole("button", { name: /mark as ready/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/videos/v1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ needs_edit: false }),
      }),
    )
    expect(refreshMock).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("toasts an error when the request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "boom" }) })
    vi.stubGlobal("fetch", fetchMock)

    render(<MarkReadyButton videoUploadId="v1" needsEdit />)
    fireEvent.click(screen.getByRole("button", { name: /mark as ready/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(refreshMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
