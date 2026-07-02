import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { ResourceStatusToggle } from "@/app/(admin)/admin/ads/campaigns/ResourceStatusToggle"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// next/navigation is globally mocked in __tests__/setup.tsx (useRouter().refresh is a vi.fn()).

beforeEach(() => {
  vi.clearAllMocks()
})

describe("<ResourceStatusToggle>", () => {
  it("opens a confirm dialog, then optimistically pauses and POSTs to endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    render(
      <ResourceStatusToggle
        endpoint="/api/admin/ads/ad-groups/ag1/status"
        resourceKind="ad group"
        resourceName="Comeback Code — Prospecting"
        initialStatus="ENABLED"
      />,
    )

    const trigger = screen.getByRole("button", { name: /pause ad group comeback code/i })
    expect(within(trigger).getByText("ENABLED")).toBeInTheDocument()

    fireEvent.click(trigger)

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/pause this ad group\?/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/comeback code — prospecting/i)).toBeInTheDocument()

    const confirmButton = within(dialog).getByRole("button", { name: /^pause$/i })
    fireEvent.click(confirmButton)

    // Optimistic flip happens synchronously on confirm.
    await waitFor(() => expect(screen.getByText("PAUSED")).toBeInTheDocument())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/ads/ad-groups/ag1/status",
        expect.objectContaining({ method: "POST" }),
      )
    })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ status: "PAUSED" })

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it("reverts to the previous status and toasts an error when the request fails (non-removed)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Google Ads API error" }),
    }) as unknown as typeof fetch

    render(
      <ResourceStatusToggle
        endpoint="/api/admin/ads/ads/ad1/status"
        resourceKind="ad"
        resourceName="Comeback Code Headline"
        initialStatus="ENABLED"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /pause ad comeback code headline/i }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /^pause$/i }))

    // The mocked fetch rejects almost immediately, so by the time we observe
    // the DOM it has already reverted from the optimistic PAUSED flip back to
    // ENABLED — assert the settled (reverted) state plus the error toast.
    await waitFor(() => expect(screen.getByText("ENABLED")).toBeInTheDocument())
    expect(toast.error).toHaveBeenCalled()
  })

  it("shows the REMOVED badge when the server reports a 409 removed conflict", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This ad group was removed in Google Ads.", removed: true }),
    }) as unknown as typeof fetch

    render(
      <ResourceStatusToggle
        endpoint="/api/admin/ads/ad-groups/ag2/status"
        resourceKind="ad group"
        resourceName="Rotational Reboot — Retargeting"
        initialStatus="ENABLED"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /pause ad group rotational reboot/i }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /^pause$/i }))

    await waitFor(() => expect(screen.getByText("REMOVED")).toBeInTheDocument())
    expect(toast.error).toHaveBeenCalled()
  })

  it("shows a Resume verb and calls the endpoint with ENABLED when starting from PAUSED", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch

    render(
      <ResourceStatusToggle
        endpoint="/api/admin/ads/ads/ad3/status"
        resourceKind="ad"
        resourceName="Step Up Headline"
        initialStatus="PAUSED"
      />,
    )

    const trigger = screen.getByRole("button", { name: /resume ad step up headline/i })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /^resume$/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/ads/ads/ad3/status",
        expect.objectContaining({ method: "POST" }),
      )
    })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ status: "ENABLED" })
  })
})
