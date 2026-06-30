import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MyFavoritesList } from "@/components/client/MyFavoritesList"
import type { ExerciseFavoriteWithExercise } from "@/types/database"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const rows: ExerciseFavoriteWithExercise[] = [
  {
    id: "f1",
    client_user_id: "c1",
    exercise_id: "e1",
    created_by: "c1",
    source: "client" as const,
    created_at: "2026-06-30T00:00:00Z",
    exercise: { id: "e1", name: "Back Squat", category: ["strength"], muscle_group: "legs", video_url: null, thumbnail_url: null, difficulty: "intermediate" },
  },
]

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch
})

describe("MyFavoritesList", () => {
  it("renders favorite exercise names", () => {
    render(<MyFavoritesList favorites={rows} />)
    expect(screen.getByText("Back Squat")).toBeInTheDocument()
  })
  it("shows an empty state when there are none", () => {
    render(<MyFavoritesList favorites={[]} />)
    expect(screen.getByText(/no favorite/i)).toBeInTheDocument()
  })
})
