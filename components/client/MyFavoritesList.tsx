"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Heart, Play } from "lucide-react"
import { toast } from "sonner"
import type { ExerciseFavoriteWithExercise } from "@/types/database"

export function MyFavoritesList({ favorites }: { favorites: ExerciseFavoriteWithExercise[] }) {
  const router = useRouter()
  const [removingId, setRemovingId] = useState<string | null>(null)

  if (favorites.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground">
        No favorite exercises yet. Tap the heart on any exercise in your workout to save it here.
      </p>
    )
  }

  async function remove(exerciseId: string) {
    setRemovingId(exerciseId)
    try {
      const res = await fetch("/api/client/exercise-favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId, favorited: false }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Couldn't remove favorite")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <ul className="space-y-2">
      {favorites.map((f) => (
        <li key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-white p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-primary">{f.exercise?.name ?? "Exercise"}</p>
            <p className="text-xs text-muted-foreground">
              {f.exercise?.muscle_group ?? ""}
              {f.source === "admin" ? " · added by coach" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {f.exercise?.video_url && (
              <a
                href={f.exercise.video_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-success"
              >
                <Play className="size-4" /> Watch
              </a>
            )}
            <button
              type="button"
              onClick={() => remove(f.exercise_id)}
              disabled={removingId === f.exercise_id}
              aria-label="Remove favorite"
              className="rounded-full p-1.5 text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Heart className="size-5 fill-accent" strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
