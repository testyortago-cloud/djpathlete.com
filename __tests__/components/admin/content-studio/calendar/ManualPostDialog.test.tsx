import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualPostDialog } from "@/components/admin/content-studio/calendar/ManualPostDialog"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<ManualPostDialog>", () => {
  it("renders platform selector and caption textarea for the given day", () => {
    render(<ManualPostDialog dayKey="2026-04-20" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText(/2026-04-20/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Platform/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Caption/i)).toBeInTheDocument()
  })

  it("submits to the manual-post API and calls onCreated", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "new-1" }), { status: 200 }),
    )
    const onCreated = vi.fn()
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: /Create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.platform).toBe("instagram")
    expect(body.caption).toBe("hello")
    expect(body.scheduled_at).toMatch(/^2099-01-/)
    expect(onCreated).toHaveBeenCalledWith("new-1")
  })
})
