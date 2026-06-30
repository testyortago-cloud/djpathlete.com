import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FavoriteExerciseButton } from "@/components/client/FavoriteExerciseButton"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe("FavoriteExerciseButton", () => {
  it("optimistically toggles on click and POSTs the desired state", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, favorited: true }) })
    render(<FavoriteExerciseButton exerciseId="ex-1" initialFavorited={false} />)
    const btn = screen.getByRole("button", { name: /favorite/i })
    expect(btn).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(btn)
    expect(btn).toHaveAttribute("aria-pressed", "true") // optimistic
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/client/exercise-favorites",
        expect.objectContaining({ method: "POST" }),
      ),
    )
  })

  it("reverts on a failed request", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) })
    render(<FavoriteExerciseButton exerciseId="ex-1" initialFavorited={false} />)
    const btn = screen.getByRole("button", { name: /favorite/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "false"))
  })
})
