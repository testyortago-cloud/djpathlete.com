import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))

// Radix Dropdown relies on Pointer Events APIs that jsdom doesn't ship.
// Without these stubs, opening the menu via fireEvent.click hangs.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

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

  it("renders a single trigger button labeled 'Make post from transcript'", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    const btn = screen.getByRole("button", { name: /make post from transcript/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  it("is disabled when hasTranscript is false", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript={false} />)
    const btn = screen.getByRole("button", { name: /make post from transcript/i })
    expect(btn).toBeDisabled()
  })

  // Radix DropdownMenu opens on pointerdown, then a keyboard navigation
  // step focuses the first item; Enter on that item invokes onSelect.
  // fireEvent.click alone doesn't open Radix menus in jsdom, so we drive
  // the trigger with pointerDown + keyDown(Enter).
  function openAndSelect(trigger: HTMLElement, itemNameMatcher: RegExp) {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.pointerUp(trigger, { button: 0 })
    fireEvent.click(trigger)
    return screen.findByRole("menuitem", { name: itemNameMatcher })
  }

  it("opens a menu with one item per platform", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    const trigger = screen.getByRole("button", { name: /make post from transcript/i })
    await openAndSelect(trigger, /quote carousel.+instagram/i)

    expect(screen.getByRole("menuitem", { name: /quote carousel.+facebook/i })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /quote carousel.+linkedin/i })).toBeInTheDocument()
  })

  it("POSTs the chosen platform, shows success toast, and navigates to the new post", async () => {
    const Comp = await importComp()
    render(<Comp videoUploadId="video-1" hasTranscript />)
    const trigger = screen.getByRole("button", { name: /make post from transcript/i })
    const item = await openAndSelect(trigger, /quote carousel.+instagram/i)
    fireEvent.click(item)

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
    expect(body.platform).toBe("instagram")
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
    const trigger = screen.getByRole("button", { name: /make post from transcript/i })
    const item = await openAndSelect(trigger, /quote carousel.+facebook/i)
    fireEvent.click(item)

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
