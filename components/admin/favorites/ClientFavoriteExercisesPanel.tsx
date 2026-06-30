"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Heart, Plus } from "lucide-react"
import { toast } from "sonner"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Button } from "@/components/ui/button"
import type { ExerciseFavoriteWithExercise } from "@/types/database"

export function ClientFavoriteExercisesPanel({
  clientId,
  initialFavorites,
  exerciseOptions,
}: {
  clientId: string
  initialFavorites: ExerciseFavoriteWithExercise[]
  exerciseOptions: ComboboxOption[]
}) {
  const router = useRouter()
  const [picked, setPicked] = useState("")
  const [busy, setBusy] = useState(false)

  async function call(method: "POST" | "DELETE", exerciseId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/exercise-favorites`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Could not update favorites")
    } finally {
      setBusy(false)
    }
  }

  const favoritedIds = new Set(initialFavorites.map((f) => f.exercise_id))
  const addable = exerciseOptions.filter((o) => !favoritedIds.has(o.value))

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary">
        <Heart className="size-5" strokeWidth={1.5} /> Favorite Exercises
      </h2>

      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <Combobox
            options={addable}
            value={picked}
            onChange={setPicked}
            placeholder="Add a favorite for this client…"
            searchPlaceholder="Search exercises…"
          />
        </div>
        <Button
          type="button"
          disabled={!picked || busy}
          onClick={async () => {
            await call("POST", picked)
            setPicked("")
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>

      {initialFavorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favorite exercises yet.</p>
      ) : (
        <ul className="space-y-2">
          {initialFavorites.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
              <span className="min-w-0 truncate">
                <span className="font-medium text-primary">{f.exercise?.name ?? "Exercise"}</span>
                {f.source === "admin" && <span className="ml-2 text-xs text-muted-foreground">added by coach</span>}
              </span>
              <button
                type="button"
                aria-label="Remove favorite"
                disabled={busy}
                onClick={() => call("DELETE", f.exercise_id)}
                className="rounded-full p-1.5 text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                <Heart className="size-5 fill-accent" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
