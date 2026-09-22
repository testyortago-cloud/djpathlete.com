"use client"

// components/admin/pipeline-settings.tsx — G29 Task 7. Reshape one board's
// stage list (rename, re-kind, re-threshold, reorder, add, remove), then PUT
// the WHOLE list to /api/admin/pipeline/boards/[id]/stages. Also renames,
// archives and creates boards, because this screen is the only surface those
// three routes have.
//
// THE RULES ARE NOT RE-IMPLEMENTED HERE. `validateStageList`, `planStageSave`
// and `strandedStageProblems` (lib/lead-engine/stage-list.ts) are the SAME
// pure functions the route and the DAL call before writing. Running them here
// too is what makes the feedback exact instead of approximate — a second copy
// of any rule drifts, and the coach finds out when a board they thought was
// fine refuses every save.
//
// AND THEY ARE A CONVENIENCE, NOT THE GUARD. The route and migration 00276
// are the invariants; this screen re-runs them only so a problem appears
// without a round trip. Two consequences, both deliberate:
//   * `handleSaveStages` re-checks the problems ITSELF and returns early.
//     The disabled Save button is a hint, not a gate — a form submitted by a
//     keyboard, a script, or a stale `disabled` attribute still sends
//     nothing. `__tests__/components/admin/pipeline-settings.test.tsx`
//     submits the form directly, with a valid-state control, to prove it.
//   * The route's own refusals (`problems[]` off a 400) are rendered in the
//     same places the local ones are, rather than flattened into a toast.
//
// THE `position` TRAP. `SavedStage` HAS a `position`; `StageDraft` does NOT,
// and `StageDraftSchema` is `.strict()` — mapping the loaded rows straight
// into the request body sends `position` and the route rejects THE WHOLE
// SAVE. `toEditable` below drops it on the way in, and `toDrafts` builds the
// payload field by field on the way out. The submitted ARRAY ORDER is the
// position; nothing else carries it.

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"
import { cn } from "@/lib/utils"
import {
  MAX_STAGE_KEY_LENGTH,
  MAX_STAGE_NAME_LENGTH,
  planStageSave,
  strandedStageProblems,
  validateStageList,
  type SavedStage,
  type StageDraft,
  type StageKind,
  type StageProblem,
} from "@/lib/lead-engine/stage-list"

/**
 * What a coach reads instead of the stored kind. A Record over the union, so
 * a fourth kind cannot be added without writing a plain-language name for it
 * — the same trick `BRANCH_KIND_LABEL` uses in the step editor.
 */
const KIND_LABEL: Record<StageKind, string> = {
  open: "Still open",
  won: "Won",
  lost: "Lost",
}

/** The order the picker offers them in — open first, because most stages are. */
const KIND_ORDER: StageKind[] = ["open", "won", "lost"]

type PipelineSettingsBoard = { id: string; key: string; name: string }

/**
 * One row of the editor. Note what is NOT here: `position`. See the header.
 *
 * `_key` is the stable React key — the database id for a saved stage, a
 * generated one for a stage that does not exist yet — and it is also the id
 * @dnd-kit sorts on, so a drag can never depend on an array index that the
 * drag itself is about to change.
 *
 * `amber` / `red` are held as the TEXT in the box, not as numbers. Empty
 * means "no threshold" (null), and a half-typed value stays exactly as typed
 * instead of being rounded, NaN-ed or silently cleared on its way through a
 * parse.
 */
type EditableStage = {
  _key: string
  id: string | null
  key: string
  /** True once the coach has typed the key themselves — stops the name suggesting over it. */
  keyTouched: boolean
  name: string
  kind: StageKind
  amber: string
  red: string
}

function toEditable(stages: SavedStage[]): EditableStage[] {
  // `position` is read and DROPPED here, deliberately — see the file header.
  return stages.map((s) => ({
    _key: s.id,
    id: s.id,
    key: s.key,
    keyTouched: true,
    name: s.name,
    kind: s.kind,
    amber: s.amberAfterDays === null ? "" : String(s.amberAfterDays),
    red: s.redAfterDays === null ? "" : String(s.redAfterDays),
  }))
}

/** Blank, or a whole number 0 or more. Anything else is a field problem, not a silent null. */
function isDaysText(text: string): boolean {
  const t = text.trim()
  if (t === "") return true
  return /^\d+$/.test(t)
}

function toDays(text: string): number | null {
  const t = text.trim()
  if (t === "" || !isDaysText(t)) return null
  return Number(t)
}

/**
 * The request body, built field by field. Six keys, no more: `StageDraftSchema`
 * is `.strict()` and rejects the whole payload over one extra one.
 */
function toDrafts(rows: EditableStage[]): StageDraft[] {
  return rows.map((r) => ({
    id: r.id,
    key: r.key.trim(),
    name: r.name.trim(),
    kind: r.kind,
    amberAfterDays: toDays(r.amber),
    redAfterDays: toDays(r.red),
  }))
}

/**
 * `"Proposal Sent"` -> `"proposal_sent"`. The same shape `slugifyBoardKey`
 * (lib/db/pipeline.ts) gives a board, re-stated here because that one lives
 * in a server-only module a client component cannot import. It only SUGGESTS
 * a key — `validateStageList` and the route decide whether the result is
 * acceptable, and the coach can overwrite it.
 */
function suggestKey(name: string): string {
  const collapsed = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return collapsed.slice(0, MAX_STAGE_KEY_LENGTH).replace(/_+$/g, "")
}

function cardsPhrase(count: number): string {
  if (count === 0) return "No cards"
  return count === 1 ? "1 card" : `${count} cards`
}

/**
 * The limits the ROUTE enforces, checked here so one over-long name lands on
 * its own row instead of losing every other edit on the screen to a single
 * whole-payload `.max()` refusal. The numbers and the wording both come from
 * `stage-list.ts`, which is the route's source for them too.
 */
function fieldProblems(rows: EditableStage[]): StageProblem[] {
  const problems: StageProblem[] = []
  rows.forEach((r, index) => {
    if (r.name.trim().length > MAX_STAGE_NAME_LENGTH) {
      problems.push({ index, message: `Stage name must be ${MAX_STAGE_NAME_LENGTH} characters or fewer.` })
    }
    if (r.key.trim().length > MAX_STAGE_KEY_LENGTH) {
      problems.push({ index, message: `Stage key must be ${MAX_STAGE_KEY_LENGTH} characters or fewer.` })
    }
    if (!isDaysText(r.amber) || !isDaysText(r.red)) {
      problems.push({ index, message: "Days must be a whole number, 0 or more. Leave it blank for no warning." })
    }
  })
  return problems
}

export function PipelineSettings({
  board,
  stages,
  cardCounts,
  isDefaultBoard = false,
}: {
  board: PipelineSettingsBoard
  /** readStagesForEdit's `stages`, in position order. */
  stages: SavedStage[]
  /**
   * readStagesForEdit's `cardCountByStageId`, flattened to a plain object by
   * the server component — a Map is not something to hand across the
   * server/client boundary. A stage with no cards is ABSENT, not 0.
   */
  cardCounts: Record<string, number>
  /** `board.key === DEFAULT_PIPELINE_KEY`. Decided by the server so this file needs no constant. */
  isDefaultBoard?: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<EditableStage[]>(() => toEditable(stages))
  const [destinations, setDestinations] = useState<Record<string, string>>({})
  const [serverProblems, setServerProblems] = useState<StageProblem[]>([])
  const [savingStages, setSavingStages] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)
  const [boardName, setBoardName] = useState(board.name)
  const [boardBusy, setBoardBusy] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [newBoardName, setNewBoardName] = useState("")
  const nextKeyRef = useRef(0)

  // No local state survives a successful save except what comes back down as
  // props — the same rule StepEditor follows, and the only place a stage
  // created with `id: null` picks up its real database id.
  useEffect(() => {
    setRows(toEditable(stages))
    setDestinations({})
    setServerProblems([])
    setStageError(null)
  }, [stages])

  useEffect(() => {
    setBoardName(board.name)
    setConfirmingArchive(false)
    setBoardError(null)
  }, [board])

  const drafts = useMemo(() => toDrafts(rows), [rows])
  const cardCountMap = useMemo(() => new Map(Object.entries(cardCounts)), [cardCounts])
  const listProblems = useMemo(() => validateStageList(drafts), [drafts])
  const localFieldProblems = useMemo(() => fieldProblems(rows), [rows])
  const plan = useMemo(
    () => planStageSave(stages, drafts, cardCountMap, new Map(Object.entries(destinations))),
    [stages, drafts, cardCountMap, destinations],
  )
  const stranded = useMemo(() => strandedStageProblems(stages, plan, cardCountMap), [stages, plan, cardCountMap])

  /** What stops a save. The server's own problems are shown but never block a retry. */
  const blocking = useMemo(
    () => [...listProblems, ...localFieldProblems, ...stranded],
    [listProblems, localFieldProblems, stranded],
  )
  const allProblems = useMemo(() => [...blocking, ...serverProblems], [blocking, serverProblems])
  const boardLevelProblems = allProblems.filter((p) => p.index === null)
  function problemsForRow(index: number): StageProblem[] {
    return allProblems.filter((p) => p.index === index)
  }

  /** Removed stages that still hold cards — each needs somewhere for them to go. */
  const strandedRemovals = plan.removedStageIds
    .filter((id) => (cardCounts[id] ?? 0) > 0)
    .map((id) => ({ id, stage: stages.find((s) => s.id === id) ?? null, cards: cardCounts[id] ?? 0 }))

  /** Only a stage that already EXISTS can receive cards — a row with `id: null` has no row to move them to yet. */
  const destinationOptions = rows
    .filter((r) => r.id !== null)
    .map((r) => ({ id: r.id as string, name: r.name.trim() || "Untitled stage" }))

  /** Every edit clears the server's stale complaints; they describe a payload that no longer exists. */
  function editRows(next: (prev: EditableStage[]) => EditableStage[]) {
    setServerProblems([])
    setStageError(null)
    setRows(next)
  }

  function updateRow(key: string, patch: Partial<EditableStage>) {
    editRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  }

  function changeName(row: EditableStage, name: string) {
    // A saved stage's key is immutable (spec invariant 4), so the suggestion
    // only ever applies to a stage that does not exist yet and whose key the
    // coach has not typed over.
    const patch: Partial<EditableStage> = { name }
    if (row.id === null && !row.keyTouched) patch.key = suggestKey(name)
    updateRow(row._key, patch)
  }

  function moveRow(index: number, delta: -1 | 1) {
    editRows((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      return arrayMove(prev, index, target)
    })
  }

  function removeRow(key: string) {
    editRows((prev) => prev.filter((r) => r._key !== key))
  }

  function addRow() {
    const key = `new-${nextKeyRef.current}`
    nextKeyRef.current += 1
    editRows((prev) => [
      ...prev,
      { _key: key, id: null, key: "", keyTouched: false, name: "", kind: "open", amber: "", red: "" },
    ])
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    editRows((prev) => {
      const from = prev.findIndex((r) => r._key === active.id)
      const to = prev.findIndex((r) => r._key === over.id)
      if (from === -1 || to === -1) return prev
      return arrayMove(prev, from, to)
    })
  }

  async function handleSaveStages() {
    // THE GUARD IS HERE, not on the button's `disabled` attribute. See the
    // file header: a disabled button is a hint, and a hint cannot be the only
    // thing standing between a coach and a bricked board.
    if (blocking.length > 0 || savingStages) return

    setSavingStages(true)
    setStageError(null)
    setServerProblems([])
    try {
      // Only the removals that actually need a destination — a key for a
      // stage that is still on the board would be ignored by `planStageSave`
      // anyway, and sending it would say something untrue about the request.
      const body: { stages: StageDraft[]; destinations?: Record<string, string> } = { stages: drafts }
      const needed: Record<string, string> = {}
      for (const removal of strandedRemovals) {
        const chosen = destinations[removal.id]
        if (chosen) needed[removal.id] = chosen
      }
      if (Object.keys(needed).length > 0) body.destinations = needed

      const res = await fetch(`/api/admin/pipeline/boards/${board.id}/stages`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; problems?: StageProblem[] }
      if (!res.ok) {
        // The route's `problems[]` keeps its structure all the way to the
        // screen, so a per-stage refusal lands on the stage it is about.
        if (Array.isArray(payload.problems)) setServerProblems(payload.problems)
        const message = payload.error ?? `Could not save the stages on "${board.name}".`
        setStageError(message)
        toast.error(message)
        return
      }
      toast.success(`Saved the stages on "${board.name}".`)
      router.refresh()
    } catch {
      const message = `Could not save the stages on "${board.name}". Check your connection and try again.`
      setStageError(message)
      toast.error(message)
    } finally {
      setSavingStages(false)
    }
  }

  async function patchBoard(patch: { name?: string; status?: "archived" }, successMessage: string) {
    if (boardBusy) return
    setBoardBusy(true)
    setBoardError(null)
    try {
      const res = await fetch(`/api/admin/pipeline/boards/${board.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        // VERBATIM. The default board's archive refusal is written for a
        // coach to read and act on; a generic "that did not work" would hide
        // the one sentence that says why.
        const message = payload.error ?? "That change could not be saved."
        setBoardError(message)
        toast.error(message)
        return
      }
      toast.success(successMessage)
      router.refresh()
    } catch {
      const message = "That change could not be saved. Check your connection and try again."
      setBoardError(message)
      toast.error(message)
    } finally {
      setBoardBusy(false)
      setConfirmingArchive(false)
    }
  }

  async function handleCreateBoard() {
    const name = newBoardName.trim()
    if (name.length === 0 || boardBusy) return
    setBoardBusy(true)
    setBoardError(null)
    try {
      const res = await fetch("/api/admin/pipeline/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        board?: { id?: string; key?: string }
      }
      if (!res.ok) {
        const message = payload.error ?? "That board could not be created."
        setBoardError(message)
        toast.error(message)
        return
      }
      toast.success(`Created "${name}".`)
      setNewBoardName("")
      // Straight into the new board's own settings — it starts with only the
      // Won and Lost stages `createPipelineBoard` seeds, so there is always
      // something to do next.
      if (payload.board?.key) {
        router.push(`/admin/pipeline/settings?board=${encodeURIComponent(payload.board.key)}`)
      }
      router.refresh()
    } catch {
      const message = "That board could not be created. Check your connection and try again."
      setBoardError(message)
      toast.error(message)
    } finally {
      setBoardBusy(false)
    }
  }

  return (
    <div className="space-y-6 font-body">
      {/* ---------------------------------------------------------------- */}
      {/* The board itself                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-primary">This board</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="board-name">Board name</Label>
            <Input
              id="board-name"
              value={boardName}
              maxLength={200}
              onChange={(e) => setBoardName(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={boardBusy || boardName.trim().length === 0 || boardName === board.name}
            onClick={() => void patchBoard({ name: boardName.trim() }, "Renamed the board.")}
          >
            Save board name
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Its short name is <span className="font-mono">{board.key}</span>. That one never changes — every card already
          filed against this board points at it.
        </p>

        <div className="mt-4 border-t border-border pt-4">
          {isDefaultBoard ? (
            <p className="text-sm text-muted-foreground">
              This is the board every enquiry lands on when nothing else claims it, so it cannot be archived.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Archiving takes this board off the pipeline screens. Its cards are not deleted, but you will not be able
              to bring it back yourself yet — ask your developer if you need it again.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {confirmingArchive ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={boardBusy}
                  onClick={() => void patchBoard({ status: "archived" }, `Archived "${board.name}".`)}
                >
                  Yes, archive it
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmingArchive(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              // Deliberately NOT disabled for the default board. The route is
              // the guard, and it answers with a sentence explaining why —
              // which is worth more than a button that quietly does nothing.
              <Button type="button" variant="outline" disabled={boardBusy} onClick={() => setConfirmingArchive(true)}>
                Archive this board
              </Button>
            )}
          </div>
        </div>

        {boardError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {boardError}
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The stage list                                                    */}
      {/* ---------------------------------------------------------------- */}
      <form
        data-testid="stage-form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSaveStages()
        }}
        className="space-y-4"
      >
        {boardLevelProblems.length > 0 ? (
          <div
            role="alert"
            data-testid="board-problems"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <p className="font-medium">Fix these before you can save:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {boardLevelProblems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {strandedRemovals.length > 0 ? (
          <div className="rounded-xl border border-border bg-surface/40 p-4">
            <p className="text-sm font-medium text-primary">These cards need somewhere to go</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You have taken a stage off the board that still has cards on it. Say where they should move to, and they
              will be moved in the same step that removes the stage.
            </p>
            <div className="mt-3 space-y-3">
              {strandedRemovals.map((removal) => {
                const label = `Where should the ${cardsPhrase(removal.cards).toLowerCase()} on "${
                  removal.stage?.name ?? removal.id
                }" go?`
                return (
                  <div key={removal.id}>
                    <Label htmlFor={`destination-${removal.id}`}>{label}</Label>
                    <select
                      id={`destination-${removal.id}`}
                      value={destinations[removal.id] ?? ""}
                      onChange={(e) => {
                        setServerProblems([])
                        setDestinations((prev) => ({ ...prev, [removal.id]: e.target.value }))
                      }}
                      className="mt-1 h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
                    >
                      <option value="">Choose a stage…</option>
                      {destinationOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <DataTableCard>
          <DataTableToolbar className="items-center justify-between sm:items-center">
            <div>
              <h2 className="text-lg font-semibold text-primary">Stages</h2>
              <p className="text-sm text-muted-foreground">
                Drag a stage to change the order cards move through. Every board needs one Won stage and one Lost stage.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={addRow} className="shrink-0">
              <Plus className="size-4" />
              Add a stage
            </Button>
          </DataTableToolbar>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <DataTable>
              <DataTableHeader>
                <DataTableHead className="w-24">Order</DataTableHead>
                <DataTableHead>Name</DataTableHead>
                <DataTableHead>Short name</DataTableHead>
                <DataTableHead>Kind</DataTableHead>
                <DataTableHead>Slow after (days)</DataTableHead>
                <DataTableHead>No reply after (days)</DataTableHead>
                <DataTableHead>Cards</DataTableHead>
                <DataTableHead align="right">Remove</DataTableHead>
              </DataTableHeader>
              <tbody>
                <SortableContext items={rows.map((r) => r._key)} strategy={verticalListSortingStrategy}>
                  {rows.map((row, index) => (
                    <StageRow
                      key={row._key}
                      row={row}
                      index={index}
                      total={rows.length}
                      cards={row.id ? (cardCounts[row.id] ?? 0) : 0}
                      problems={problemsForRow(index)}
                      onChange={(patch) => updateRow(row._key, patch)}
                      onChangeName={(name) => changeName(row, name)}
                      onMoveUp={() => moveRow(index, -1)}
                      onMoveDown={() => moveRow(index, 1)}
                      onRemove={() => removeRow(row._key)}
                    />
                  ))}
                </SortableContext>
                {rows.length === 0 ? (
                  <DataTableEmpty colSpan={8}>
                    This board has no stages. Add at least one Won stage and one Lost stage before saving.
                  </DataTableEmpty>
                ) : null}
              </tbody>
            </DataTable>
          </DndContext>

          <DataTableFooter>
            <p className="text-sm text-destructive">{stageError ?? ""}</p>
            <Button type="submit" disabled={savingStages || blocking.length > 0}>
              {savingStages ? "Saving…" : "Save stages"}
            </Button>
          </DataTableFooter>
        </DataTableCard>
      </form>

      {/* ---------------------------------------------------------------- */}
      {/* Another board                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-primary">Add another board</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A new board starts with a Won stage and a Lost stage. Add the steps in between once it exists.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="new-board-name">New board name</Label>
            <Input
              id="new-board-name"
              value={newBoardName}
              maxLength={200}
              placeholder="Camps &amp; clinics"
              onChange={(e) => setNewBoardName(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={boardBusy || newBoardName.trim().length === 0}
            onClick={() => void handleCreateBoard()}
          >
            Create board
          </Button>
        </div>
      </section>
    </div>
  )
}

function StageRow({
  row,
  index,
  total,
  cards,
  problems,
  onChange,
  onChangeName,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  row: EditableStage
  index: number
  total: number
  cards: number
  problems: StageProblem[]
  onChange: (patch: Partial<EditableStage>) => void
  onChangeName: (name: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row._key })
  const n = index + 1

  return (
    <DataTableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`stage-row-${index}`}
      className={cn("align-top", isDragging && "opacity-50")}
    >
      <DataTableCell>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder stage ${n}`}
            className="cursor-grab touch-none text-muted-foreground hover:text-primary active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
          {/* The same move, without a mouse. @dnd-kit's keyboard sensor needs
              focus on the handle and a modifier dance; two buttons are the
              thing a coach finds. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move stage ${n} up`}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label={`Move stage ${n} down`}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
      </DataTableCell>

      <DataTableCell>
        <Input
          aria-label={`Stage ${n} name`}
          value={row.name}
          maxLength={MAX_STAGE_NAME_LENGTH}
          onChange={(e) => onChangeName(e.target.value)}
          className="min-w-40"
        />
        <RowProblems problems={problems} />
      </DataTableCell>

      <DataTableCell>
        {/* Invariant 4: a saved stage's key is immutable. Every
            `opportunity_stage_events` row already written references it, and
            the SQL never updates the column — so the box says so rather than
            accepting an edit the save would drop. */}
        <Input
          aria-label={`Stage ${n} key`}
          value={row.key}
          readOnly={row.id !== null}
          maxLength={MAX_STAGE_KEY_LENGTH}
          onChange={(e) => onChange({ key: e.target.value, keyTouched: true })}
          className={cn("min-w-32 font-mono text-xs", row.id !== null && "bg-surface/50 text-muted-foreground")}
          title={row.id !== null ? "A stage's short name cannot change once it exists." : undefined}
        />
      </DataTableCell>

      <DataTableCell>
        <select
          aria-label={`Stage ${n} kind`}
          value={row.kind}
          onChange={(e) => onChange({ kind: e.target.value as StageKind })}
          className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
        >
          {KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </DataTableCell>

      <DataTableCell>
        <Input
          aria-label={`Stage ${n}: days in this step before it looks slow`}
          type="number"
          min={0}
          step={1}
          value={row.amber}
          onChange={(e) => onChange({ amber: e.target.value })}
          className="w-24"
        />
      </DataTableCell>

      <DataTableCell>
        <Input
          aria-label={`Stage ${n}: days with no reply before it is flagged`}
          type="number"
          min={0}
          step={1}
          value={row.red}
          onChange={(e) => onChange({ red: e.target.value })}
          className="w-24"
        />
      </DataTableCell>

      <DataTableCell>
        <DataTableBadge tone={cards > 0 ? "info" : "neutral"} className="whitespace-nowrap">
          {cardsPhrase(cards)}
        </DataTableBadge>
      </DataTableCell>

      <DataTableCell align="right">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove stage ${n}`}>
          <Trash2 className="size-4" />
        </Button>
      </DataTableCell>
    </DataTableRow>
  )
}

/** A problem belongs to the field it is about, not to a list at the top of the screen. */
function RowProblems({ problems }: { problems: StageProblem[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-destructive">
      {problems.map((p, i) => (
        <li key={i}>{p.message}</li>
      ))}
    </ul>
  )
}
