"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DataTableCard,
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableBadge,
} from "@/components/ui/data-table"
import type { ExerciseBlockRow } from "@/lib/db/exercise-blocks"

interface BlockedExercisesCardProps {
  blocks: ExerciseBlockRow[]
  /** Heading for this list — the scope is what distinguishes the two mounts. */
  scopeLabel: string
  emptyHint: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/**
 * Read-and-remove view of the blocklist. Adding happens on the ⊘ in a program,
 * never here — this exists so a list you can only add to does not quietly
 * narrow generation with no way to find out why.
 */
export function BlockedExercisesCard({ blocks, scopeLabel, emptyHint }: BlockedExercisesCardProps) {
  const router = useRouter()
  const [rows, setRows] = useState(blocks)
  const [removing, setRemoving] = useState<string | null>(null)

  async function handleUnblock(id: string, name: string) {
    setRemoving(id)
    try {
      const res = await fetch(`/api/admin/exercises/blocks/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Could not unblock this exercise")
      setRows((prev) => prev.filter((r) => r.id !== id))
      toast.success(`${name} unblocked`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unblock this exercise")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <DataTableCard>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Ban className="size-4 text-destructive" />
        <h2 className="text-sm font-medium text-primary">{scopeLabel}</h2>
        {rows.length > 0 && <span className="text-xs text-muted-foreground">({rows.length})</span>}
      </div>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Exercise</DataTableHead>
          <DataTableHead>Movement</DataTableHead>
          <DataTableHead>Reason</DataTableHead>
          <DataTableHead>Blocked</DataTableHead>
          <DataTableHead align="right">Action</DataTableHead>
        </DataTableHeader>
        <tbody>
          {rows.length === 0 ? (
            <DataTableEmpty colSpan={5}>{emptyHint}</DataTableEmpty>
          ) : (
            rows.map((row) => {
              const name = row.exercises?.name ?? "Removed exercise"
              return (
                <DataTableRow key={row.id}>
                  <DataTableCell className="font-medium">{name}</DataTableCell>
                  <DataTableCell>
                    {row.exercises?.movement_pattern ? (
                      <DataTableBadge tone="neutral">{row.exercises.movement_pattern}</DataTableBadge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell muted>{row.reason?.trim() ? row.reason : "—"}</DataTableCell>
                  <DataTableCell muted>{formatDate(row.created_at)}</DataTableCell>
                  <DataTableCell align="right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={removing === row.id}
                      onClick={() => handleUnblock(row.id, name)}
                    >
                      {removing === row.id ? "Unblocking…" : "Unblock"}
                    </Button>
                  </DataTableCell>
                </DataTableRow>
              )
            })
          )}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
