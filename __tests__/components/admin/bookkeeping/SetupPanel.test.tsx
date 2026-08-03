import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { SetupBanner, SetupPanel } from "@/components/admin/bookkeeping/SetupPanel"

const item = (key: string, status = "todo", over: Record<string, unknown> = {}) =>
  ({ key, title: `Title ${key}`, why: "why", status, href: "/admin/books", ...over })
const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal("fetch", fetchMock)
})
function mockStatus(items: unknown[], tourCompletedAt: string | null = null) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return new Response(JSON.stringify({
        items, totalCount: items.length,
        doneCount: (items as { status: string }[]).filter((i) => i.status === "done").length,
        tourCompletedAt,
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })
}

describe("<SetupBanner>", () => {
  it("shows progress while incomplete and opens on click", async () => {
    mockStatus([item("a", "done"), item("b")])
    const onOpen = vi.fn()
    render(<SetupBanner onOpen={onOpen} />)
    expect(await screen.findByText(/1 of 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /set.?up/i }))
    expect(onOpen).toHaveBeenCalled()
  })
  it("renders nothing when everything is done", async () => {
    mockStatus([item("a", "done")])
    const { container } = render(<SetupBanner onOpen={() => {}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
  it("stays hidden after dismissal", async () => {
    localStorage.setItem("books_setup_banner_dismissed", "1")
    mockStatus([item("b")])
    const { container } = render(<SetupBanner onOpen={() => {}} />)
    await waitFor(() => {})
    expect(container.textContent).toBe("")
  })
})

describe("<SetupPanel>", () => {
  it("renders items with status icons, attention detail, and fix links", async () => {
    mockStatus([
      item("gmail_label", "attention", { detail: "cron never ran" }),
      item("tax_rate", "todo", { href: "/admin/books/insights" }),
    ])
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={() => {}} />)
    expect(await screen.findByText("cron never ran")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /fix/i })[0]).toHaveAttribute("href", "/admin/books/insights")
  })
  it("manual item checkbox PATCHes {key, checked}", async () => {
    mockStatus([item("categories_reviewed", "todo", { manual: true })])
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={() => {}} />)
    fireEvent.click(await screen.findByRole("checkbox"))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ key: "categories_reviewed", checked: true })
    })
  })
  it("advanced items hide behind the collapsed Optional extras section", async () => {
    mockStatus([
      item("tax_rate", "todo"),
      item("housekeeping", "todo", { advanced: true, title: "Automatic cleanup" }),
    ])
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={() => {}} />)
    expect(await screen.findByText("Title tax_rate")).toBeInTheDocument()
    expect(screen.queryByText("Automatic cleanup")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /optional extras/i }))
    expect(screen.getByText("Automatic cleanup")).toBeInTheDocument()
  })

  it("footer offers the tour and fires onStartTour", async () => {
    mockStatus([item("a", "done")])
    const onStartTour = vi.fn()
    render(<SetupPanel open onOpenChange={() => {}} onStartTour={onStartTour} />)
    fireEvent.click(await screen.findByRole("button", { name: /take the tour/i }))
    expect(onStartTour).toHaveBeenCalled()
  })
})
