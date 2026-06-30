"use client"

import { useState } from "react"
import { Heart } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function FavoriteExerciseButton({
  exerciseId,
  initialFavorited,
}: {
  exerciseId: string
  initialFavorited: boolean
}) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [busy, setBusy] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation() // don't expand/collapse the card
    if (busy) return
    const next = !favorited
    setFavorited(next) // optimistic
    setBusy(true)
    try {
      const res = await fetch("/api/client/exercise-favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId, favorited: next }),
      })
      if (!res.ok) throw new Error("failed")
    } catch {
      setFavorited(!next) // revert
      toast.error("Couldn't update favorite")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove favorite" : "Add favorite"}
      title={favorited ? "Favorited" : "Add to favorites"}
      className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent/40 disabled:opacity-50"
    >
      <Heart className={cn("size-5", favorited && "fill-accent text-accent")} strokeWidth={1.5} />
    </button>
  )
}
