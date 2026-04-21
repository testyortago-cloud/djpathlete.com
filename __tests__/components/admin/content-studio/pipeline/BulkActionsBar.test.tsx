import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BulkActionsBar } from "@/components/admin/content-studio/pipeline/BulkActionsBar"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<BulkActionsBar>", () => {
  it("does not render when no ids are selected", () => {
    const { container } = render(
      <BulkActionsBar selectedIds={new Set()} onClear={vi.fn()} onApproved={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("shows an Approve N button when selection is non-empty", () => {
    render(
      <BulkActionsBar
        selectedIds={new Set(["a", "b", "c"])}
        onClear={vi.fn()}
        onApproved={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: /Approve 3/i })).toBeInTheDocument()
  })

  it("clicking Approve N calls the API for each id and invokes onApproved", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const onApproved = vi.fn()
    render(
      <BulkActionsBar
        selectedIds={new Set(["a", "b"])}
        onClear={vi.fn()}
        onApproved={onApproved}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Approve 2/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onApproved).toHaveBeenCalled()
  })

  it("calls onClear when Clear is clicked", () => {
    const onClear = vi.fn()
    render(
      <BulkActionsBar selectedIds={new Set(["a"])} onClear={onClear} onApproved={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /clear/i }))
    expect(onClear).toHaveBeenCalled()
  })
})
