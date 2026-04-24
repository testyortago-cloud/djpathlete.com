import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))

describe("GenerateQuoteCardsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ postId: "post-1", mediaAssetIds: ["a-1", "a-2"] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
  })

  async function importComp() {
    const mod = await import(
      "@/components/admin/content-studio/drawer/GenerateQuoteCardsButton"
    )
    return mod.GenerateQuoteCardsButton
  }

  it("renders the button with a label that mentions quote cards", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    const btn = screen.getByRole("button", { name: /quote/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  it("is disabled when hasTranscript is false", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript={false} />)
    const btn = screen.getByRole("button", { name: /quote/i })
    expect(btn).toBeDisabled()
  })

  it("POSTs to the endpoint, shows success toast, and navigates to the new post on success", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    fireEvent.click(screen.getByRole("button", { name: /quote/i }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin/content/post/post-1"))
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/content-studio/quote-cards",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    )
    const body = JSON.parse(((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string)
    expect(body.videoUploadId).toBe("video-1")
    expect(mockToastSuccess).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("shows error toast and does not navigate when the endpoint returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "transcript too short" }), { status: 422 }),
      ),
    )
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    fireEvent.click(screen.getByRole("button", { name: /quote/i }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("disables the button while the request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    const btn = screen.getByRole("button", { name: /quote/i })
    fireEvent.click(btn)
    // After click, button should be disabled until fetch resolves
    await waitFor(() => expect(btn).toBeDisabled())
    resolveFetch(
      new Response(JSON.stringify({ postId: "post-1", mediaAssetIds: [] }), { status: 200 }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
  })
})
