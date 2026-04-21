import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GlobalSearch } from "@/components/admin/content-studio/search/GlobalSearch"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<GlobalSearch>", () => {
  it("debounces typing before firing a request", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ videos: [], transcripts: [], posts: [] }),
        { status: 200 },
      ),
    )
    render(<GlobalSearch />)
    const input = screen.getByPlaceholderText(/Search videos/i)
    fireEvent.change(input, { target: { value: "r" } })
    fireEvent.change(input, { target: { value: "ro" } })
    fireEvent.change(input, { target: { value: "rot" } })
    expect(fetchMock).not.toHaveBeenCalled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/content-studio/search?q=rot",
      expect.any(Object),
    )
  })

  it("closes the dropdown on Escape", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ videos: [], transcripts: [], posts: [] }),
        { status: 200 },
      ),
    )
    render(<GlobalSearch />)
    const input = screen.getByPlaceholderText(/Search videos/i)
    fireEvent.change(input, { target: { value: "x" } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument()
  })
})
