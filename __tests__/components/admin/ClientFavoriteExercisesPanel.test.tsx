// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ClientFavoriteExercisesPanel } from "@/components/admin/favorites/ClientFavoriteExercisesPanel"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const fav = {
  id: "f1",
  client_user_id: "c1",
  exercise_id: "e1",
  created_by: "c1",
  source: "client" as const,
  created_at: "2026-06-30T00:00:00Z",
  exercise: { id: "e1", name: "Deadlift", category: ["strength"], muscle_group: "posterior", video_url: null, thumbnail_url: null, difficulty: "advanced" },
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch
})

describe("ClientFavoriteExercisesPanel", () => {
  it("renders existing favorites", () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[fav]} exerciseOptions={[{ value: "e2", label: "Bench" }]} />)
    expect(screen.getByText("Deadlift")).toBeInTheDocument()
  })
  it("shows empty state when none", () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[]} exerciseOptions={[]} />)
    expect(screen.getByText(/no favorite/i)).toBeInTheDocument()
  })
  it("DELETEs when removing a favorite", async () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[fav]} exerciseOptions={[]} />)
    fireEvent.click(screen.getByLabelText(/remove favorite/i))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/clients/c1/exercise-favorites",
        expect.objectContaining({ method: "DELETE" }),
      )
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toMatchObject({ exerciseId: "e1" })
    })
  })
})
