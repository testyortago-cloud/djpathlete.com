"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import type { Injury } from "@/types/database"

export function InjuryRehabMilestoneList({ injury }: { injury: Injury }) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [newTarget, setNewTarget] = useState("")

  async function addMilestone() {
    if (!newName.trim()) return
    const res = await fetch(`/api/injuries/${injury.id}/milestones`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        target_date: newTarget || null,
        completed_date: null,
        notes: null,
      }),
    })
    if (!res.ok) {
      toast.error("Failed to add milestone")
      return
    }
    setNewName("")
    setNewTarget("")
    router.refresh()
  }

  async function completeMilestone(idx: number) {
    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(`/api/injuries/${injury.id}/milestones/${idx}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed_date: today }),
    })
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {injury.rehab_milestones.length === 0 && (
        <p className="text-muted-foreground text-sm">No milestones yet.</p>
      )}
      <ul className="space-y-2">
        {injury.rehab_milestones.map((m, idx) => (
          <li key={idx} className="flex items-center gap-3 rounded border p-3">
            <Checkbox
              checked={!!m.completed_date}
              onCheckedChange={() => !m.completed_date && completeMilestone(idx)}
            />
            <div className="flex-1">
              <p className={m.completed_date ? "line-through" : ""}>{m.name}</p>
              <p className="text-muted-foreground text-xs">
                target: {m.target_date ?? "—"} · completed: {m.completed_date ?? "—"}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 border-t pt-4">
        <Input
          placeholder="Milestone name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Input
          type="date"
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          className="max-w-[180px]"
        />
        <Button onClick={addMilestone}>Add</Button>
      </div>
    </div>
  )
}
