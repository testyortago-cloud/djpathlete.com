import { render, screen, fireEvent, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { BooksTour } from "@/components/admin/bookkeeping/BooksTour"
import { startBooksTour } from "@/hooks/use-page-tour"
import { BOOKS_TOUR_STEPS } from "@/lib/bookkeeping/tour-steps"

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/books",
  useRouter: () => ({ push: pushMock }),
}))

function mountTarget(id: string) {
  const el = document.createElement("div")
  el.setAttribute("data-tour", id)
  el.getBoundingClientRect = () => new DOMRect(10, 20, 300, 40)
  el.scrollIntoView = vi.fn()
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  document.body.innerHTML = ""
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
})

describe("<BooksTour>", () => {
  it("renders nothing while inactive", () => {
    mountTarget("toolbar")
    const { container } = render(<BooksTour />)
    expect(container.textContent).toBe("")
  })
  it("starting the tour spotlights step 1 and Next advances within the page", async () => {
    for (const s of BOOKS_TOUR_STEPS.filter((x) => x.page === "/admin/books")) mountTarget(s.id)
    render(<BooksTour />)
    act(() => startBooksTour())
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(screen.getByText(BOOKS_TOUR_STEPS[0].title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(screen.getByText(BOOKS_TOUR_STEPS[1].title)).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
  it("Next on the page's last step navigates to the next page and keeps state", async () => {
    for (const s of BOOKS_TOUR_STEPS.filter((x) => x.page === "/admin/books")) mountTarget(s.id)
    const lastOnPage = BOOKS_TOUR_STEPS.filter((s) => s.page === "/admin/books").length - 1
    sessionStorage.setItem("books_tour_state", JSON.stringify({ stepIndex: lastOnPage }))
    render(<BooksTour />)
    act(() => window.dispatchEvent(new Event("books-tour-changed")))
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    expect(pushMock).toHaveBeenCalledWith(BOOKS_TOUR_STEPS[lastOnPage + 1].page)
    expect(JSON.parse(sessionStorage.getItem("books_tour_state")!)).toEqual({ stepIndex: lastOnPage + 1 })
  })
  it("close clears the sessionStorage state", async () => {
    mountTarget("toolbar")
    render(<BooksTour />)
    act(() => startBooksTour())
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    fireEvent.click(screen.getByRole("button", { name: /close tour/i }))
    expect(sessionStorage.getItem("books_tour_state")).toBeNull()
  })
})
