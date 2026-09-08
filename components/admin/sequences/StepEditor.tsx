"use client"

// components/admin/sequences/StepEditor.tsx — add / edit / reorder / remove
// the steps of one sequence, then PUT the whole list to
// PUT /api/admin/sequences/[key]/steps.
//
// VALIDATION AND THE PARTWAY-THROUGH PLAN ARE NOT REIMPLEMENTED HERE.
// `validateStepList` and `planStepSave` (lib/lead-engine/step-list.ts) are the
// SAME pure functions the route calls before writing. Running them here too is
// what makes the browser's feedback exact rather than a rough approximation —
// a second copy of either rule would drift, and a coach finds out when a step
// they thought was fine fails silently at 3am. The route re-validates
// regardless; neither side is trusted alone.
//
// POSITIONS ARE NEVER TYPED, NEVER STORED IN LOCAL STATE AS RAW NUMBERS.
// step-list.ts's own rule is "the array index is the position" — so reordering
// (or removing) a step must never corrupt a branch step's target. Every step
// the operator sees carries an internal `_key` (its database id, or a
// generated one for a step not yet saved); a branch target is held as a
// REFERENCE TO A KEY, not a number, and only converted to the array index
// `StepDraft` wants at the last moment (`toStepDrafts`). Reordering therefore
// can never silently repoint a branch at the wrong step — see this file's
// `toEditableSteps` / `toStepDrafts` pair.
//
// NO LOCAL "OPTIMISTIC" STATE ACROSS A SAVE. Same shape as
// components/admin/sequences/SequenceSwitch.tsx: after a successful PUT this
// calls `router.refresh()`, and a `useEffect` resets local editable state from
// the fresh `initialSteps` prop that comes back down. That is also what gives
// a freshly created step (saved with `id: null`) its real database id, so a
// second save without further edits does not insert it a second time.

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  validateStepList,
  planStepSave,
  type StepDraft,
  type SavedStep,
  type RunPointer,
} from "@/lib/lead-engine/step-list"
import type { StepKind, BranchCondition } from "@/lib/automation/sequence-tick"

/** Table order from the brief, kept as the one true order for every kind picker on this screen. */
const STEP_KIND_ORDER: StepKind[] = ["email", "sms", "wait", "branch", "tag", "stage", "alert", "stop"]

/** Stored kind -> what a coach reads. Never the stored value itself — see task-9-brief.md's table. */
const KIND_LABEL: Record<StepKind, string> = {
  email: "Send an email",
  sms: "Send a text",
  wait: "Wait",
  branch: "Split the path",
  tag: "Add a label",
  stage: "Move their card",
  alert: "Tell the coach",
  stop: "End here",
}

const BRANCH_KIND_ORDER: BranchCondition["kind"][] = ["has_phone", "has_user", "has_consent", "source_is"]

/** The only four predicates evaluateBranch implements. Nothing else can be offered here. */
const BRANCH_KIND_LABEL: Record<BranchCondition["kind"], string> = {
  has_phone: "Has a phone number",
  has_user: "Has an account",
  has_consent: "Has agreed to be contacted",
  source_is: "Came from a particular place",
}

/**
 * A step as the editor holds it. `id` and the content fields match
 * `StepDraft` field for field; `branchTrueKey`/`branchFalseKey` replace
 * `on_true_position`/`on_false_position` with a reference to another step's
 * `_key` — see this file's header for why.
 */
type EditableStep = {
  _key: string
  id: string | null
  kind: StepKind
  wait_minutes: number | null
  subject: string | null
  body: string | null
  branch_condition: BranchCondition | null
  branchTrueKey: string | null
  branchFalseKey: string | null
  config: Record<string, unknown>
}

/** Fresh field values for a step that just became this kind — never carries over a stale subject into a text step. */
function defaultsForKind(
  kind: StepKind,
): Pick<
  EditableStep,
  "wait_minutes" | "subject" | "body" | "branch_condition" | "branchTrueKey" | "branchFalseKey" | "config"
> {
  return {
    wait_minutes: kind === "wait" ? 60 : null,
    subject: null,
    body: null,
    branch_condition: null,
    branchTrueKey: null,
    branchFalseKey: null,
    config: {},
  }
}

/** `StepDraft[]` (as loaded from the server) -> editable state, resolving each branch target's index to a `_key`. */
function toEditableSteps(drafts: StepDraft[]): EditableStep[] {
  const keys = drafts.map((d, i) => d.id ?? `initial-${i}`)
  const keyAt = (position: number | null): string | null =>
    position !== null && position >= 0 && position < keys.length ? keys[position] : null
  return drafts.map((d, i) => ({
    _key: keys[i],
    id: d.id,
    kind: d.kind,
    wait_minutes: d.wait_minutes,
    subject: d.subject,
    body: d.body,
    branch_condition: d.branch_condition,
    branchTrueKey: keyAt(d.on_true_position),
    branchFalseKey: keyAt(d.on_false_position),
    config: d.config,
  }))
}

/** Editable state -> `StepDraft[]`, resolving each branch target's `_key` back to the CURRENT array index. */
function toStepDrafts(steps: EditableStep[]): StepDraft[] {
  const indexOfKey = new Map(steps.map((s, i) => [s._key, i]))
  const positionOf = (key: string | null): number | null => (key !== null ? (indexOfKey.get(key) ?? null) : null)
  return steps.map((s) => ({
    id: s.id,
    kind: s.kind,
    wait_minutes: s.wait_minutes,
    subject: s.subject,
    body: s.body,
    branch_condition: s.branch_condition,
    on_true_position: positionOf(s.branchTrueKey),
    on_false_position: positionOf(s.branchFalseKey),
    config: s.config,
  }))
}

function peopleAre(n: number): string {
  return n === 1 ? "1 person is" : `${n} people are`
}

function peopleWill(n: number): string {
  return n === 1 ? "1 will" : `${n} will`
}

function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`
}

/** The brief's own worked sentence, with real counts substituted — never recomputed from anything but planStepSave's output. */
function partwaySummary(carryOn: number, stopped: number, total: number): string {
  const sentences = [`${peopleAre(total)} partway through.`]
  if (carryOn > 0) sentences.push(`${peopleWill(carryOn)} carry on where they are.`)
  if (stopped > 0) sentences.push(`${peopleWill(stopped)} be stopped, because the step they were on has been removed.`)
  return sentences.join(" ")
}

/** The brief's exact sentence for a step that cannot be removed, with the real sent count substituted. */
function removedSentSentence(n: number): string {
  return `This step has already been sent to ${peopleCount(n)}, so it cannot be removed. You can change what it says, or switch the whole sequence off.`
}

interface StepEditorProps {
  sequenceKey: string
  sequenceName: string
  /** Loaded from lib/db/sequence-admin.ts's loadSequenceForEdit — the editable shape, in position order. */
  initialSteps: StepDraft[]
  /** Same call's `.steps` — id + position only, the "old" side planStepSave needs. */
  oldSteps: SavedStep[]
  /** Same call's `.activeRuns` — who is partway through right now. */
  runs: RunPointer[]
  /** Same call's `.sentCountByStepId` — a step with zero sends is simply absent, not present with 0. */
  sentCountByStepId: Record<string, number>
}

export function StepEditor({
  sequenceKey,
  sequenceName,
  initialSteps,
  oldSteps,
  runs,
  sentCountByStepId,
}: StepEditorProps) {
  const router = useRouter()
  const [steps, setSteps] = useState<EditableStep[]>(() => toEditableSteps(initialSteps))
  const [addKind, setAddKind] = useState<StepKind>("email")
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const nextKeyRef = useRef(0)

  // Mirrors SequenceSwitch's own rule: no state survives a successful save
  // except what comes back down as props. This is also the ONLY place a
  // freshly created step's `id: null` becomes a real id, once the server
  // component re-fetches after router.refresh() below.
  useEffect(() => {
    setSteps(toEditableSteps(initialSteps))
    setSubmitError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSteps])

  const drafts = useMemo(() => toStepDrafts(steps), [steps])
  const problems = useMemo(() => validateStepList(drafts), [drafts])
  const plan = useMemo(() => planStepSave(oldSteps, drafts, runs), [oldSteps, drafts, runs])

  const carryOn = plan.unchanged.length + plan.repoint.length
  const stopped = plan.exit.length
  const total = carryOn + stopped

  function updateStep(key: string, patch: Partial<EditableStep>) {
    setSteps((prev) => prev.map((s) => (s._key === key ? { ...s, ...patch } : s)))
  }

  function changeKind(key: string, kind: StepKind) {
    updateStep(key, { kind, ...defaultsForKind(kind) })
  }

  function moveStep(index: number, delta: -1 | 1) {
    setSteps((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s._key !== key))
  }

  function addStep() {
    const key = `new-${nextKeyRef.current}`
    nextKeyRef.current += 1
    setSteps((prev) => [...prev, { _key: key, id: null, kind: addKind, ...defaultsForKind(addKind) }])
  }

  async function handleSave() {
    if (problems.length > 0 || saving) return
    setSaving(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/admin/sequences/${sequenceKey}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: drafts }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        const message = body.error ?? `Could not save changes to "${sequenceName}".`
        setSubmitError(message)
        toast.error(message)
        return
      }
      toast.success(`Saved changes to "${sequenceName}".`)
      router.refresh()
    } catch {
      const message = `Could not save changes to "${sequenceName}". Check your connection and try again.`
      setSubmitError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-primary">Steps</h2>

      {problems.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Fix these before you can save:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((p, i) => (
              <li key={i}>{p.index !== null ? `Step ${p.index + 1}: ${p.message}` : p.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="rounded-xl border border-border bg-surface/40 p-4 text-sm text-muted-foreground">
          {partwaySummary(carryOn, stopped, total)}
        </div>
      ) : null}

      <div className="space-y-3">
        {steps.map((step, index) => (
          <StepCard
            key={step._key}
            step={step}
            index={index}
            total={steps.length}
            allSteps={steps}
            sentCount={step.id ? (sentCountByStepId[step.id] ?? 0) : 0}
            onChange={(patch) => updateStep(step._key, patch)}
            onChangeKind={(kind) => changeKind(step._key, kind)}
            onMoveUp={() => moveStep(index, -1)}
            onMoveDown={() => moveStep(index, 1)}
            onRemove={() => removeStep(step._key)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-4">
        <Label htmlFor="add-step-kind" className="sr-only">
          Kind of step to add
        </Label>
        <select
          id="add-step-kind"
          aria-label="Kind of step to add"
          value={addKind}
          onChange={(e) => setAddKind(e.target.value as StepKind)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
        >
          {STEP_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={addStep}>
          <Plus className="size-4" />
          Add a step
        </Button>
      </div>

      {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

      <div className="flex justify-end">
        <Button type="button" onClick={() => void handleSave()} disabled={saving || problems.length > 0}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}

function StepCard({
  step,
  index,
  total,
  allSteps,
  sentCount,
  onChange,
  onChangeKind,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: EditableStep
  index: number
  total: number
  allSteps: EditableStep[]
  sentCount: number
  onChange: (patch: Partial<EditableStep>) => void
  onChangeKind: (kind: StepKind) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const removeDisabled = sentCount > 0

  return (
    <div data-testid={`step-${index}`} className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-primary">Step {index + 1}</h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={`Move step ${index + 1} up`}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label={`Move step ${index + 1} down`}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            disabled={removeDisabled}
            aria-label={`Remove step ${index + 1}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor={`${step._key}-kind`}>What this step does</Label>
        <select
          id={`${step._key}-kind`}
          aria-label={`Step ${index + 1} kind`}
          value={step.kind}
          onChange={(e) => onChangeKind(e.target.value as StepKind)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground sm:w-64"
        >
          {STEP_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {removeDisabled ? <p className="mt-2 text-xs text-muted-foreground">{removedSentSentence(sentCount)}</p> : null}

      {step.kind === "branch" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Each side needs its own ending, or the same person gets both.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {step.kind === "email" ? (
          <>
            <div>
              <Label htmlFor={`${step._key}-subject`}>Subject line</Label>
              <Input
                id={`${step._key}-subject`}
                value={step.subject ?? ""}
                onChange={(e) => onChange({ subject: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`${step._key}-body`}>What the email says</Label>
              <Textarea
                id={`${step._key}-body`}
                value={step.body ?? ""}
                onChange={(e) => onChange({ body: e.target.value })}
                className="mt-1"
              />
            </div>
          </>
        ) : null}

        {step.kind === "sms" ? (
          <div>
            <Label htmlFor={`${step._key}-body`}>What the text says</Label>
            <Textarea
              id={`${step._key}-body`}
              value={step.body ?? ""}
              onChange={(e) => onChange({ body: e.target.value })}
              className="mt-1"
            />
          </div>
        ) : null}

        {step.kind === "wait" ? (
          <div>
            <Label htmlFor={`${step._key}-wait`}>How many minutes to wait</Label>
            <Input
              id={`${step._key}-wait`}
              type="number"
              min={1}
              value={step.wait_minutes ?? ""}
              onChange={(e) => onChange({ wait_minutes: e.target.value === "" ? null : Number(e.target.value) })}
              className="mt-1 w-32"
            />
          </div>
        ) : null}

        {step.kind === "branch" ? (
          <BranchFields step={step} index={index} allSteps={allSteps} onChange={onChange} />
        ) : null}

        {step.kind === "tag" ? (
          <div>
            <Label htmlFor={`${step._key}-tag`}>The label to add</Label>
            <Input
              id={`${step._key}-tag`}
              value={typeof step.config.tag === "string" ? step.config.tag : ""}
              onChange={(e) => onChange({ config: { tag: e.target.value } })}
              className="mt-1"
            />
          </div>
        ) : null}

        {step.kind === "stage" ? (
          <div>
            <Label htmlFor={`${step._key}-stage`}>Move their card to</Label>
            <Input
              id={`${step._key}-stage`}
              value={typeof step.config.stage === "string" ? step.config.stage : ""}
              onChange={(e) => onChange({ config: { ...step.config, stage: e.target.value } })}
              className="mt-1"
            />
          </div>
        ) : null}

        {step.kind === "alert" ? (
          <>
            <div>
              <Label htmlFor={`${step._key}-subject`}>Subject line (this can be left blank)</Label>
              <Input
                id={`${step._key}-subject`}
                value={step.subject ?? ""}
                onChange={(e) => onChange({ subject: e.target.value.length > 0 ? e.target.value : null })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`${step._key}-body`}>What to tell the coach (this can be left blank)</Label>
              <Textarea
                id={`${step._key}-body`}
                value={step.body ?? ""}
                onChange={(e) => onChange({ body: e.target.value.length > 0 ? e.target.value : null })}
                className="mt-1"
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function BranchFields({
  step,
  index,
  allSteps,
  onChange,
}: {
  step: EditableStep
  index: number
  allSteps: EditableStep[]
  onChange: (patch: Partial<EditableStep>) => void
}) {
  const condition = step.branch_condition

  function setConditionKind(kind: string) {
    if (kind === "has_phone") onChange({ branch_condition: { kind: "has_phone" } })
    else if (kind === "has_user") onChange({ branch_condition: { kind: "has_user" } })
    else if (kind === "has_consent") onChange({ branch_condition: { kind: "has_consent", channel: "email" } })
    else if (kind === "source_is") onChange({ branch_condition: { kind: "source_is", value: "" } })
    else onChange({ branch_condition: null })
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${step._key}-predicate`}>What should decide the path</Label>
        <select
          id={`${step._key}-predicate`}
          aria-label={`Step ${index + 1} split rule`}
          value={condition?.kind ?? ""}
          onChange={(e) => setConditionKind(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground sm:w-72"
        >
          <option value="">Choose one…</option>
          {BRANCH_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {BRANCH_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {condition?.kind === "has_consent" ? (
        <div>
          <Label htmlFor={`${step._key}-channel`}>By which channel</Label>
          <select
            id={`${step._key}-channel`}
            aria-label={`Step ${index + 1} consent channel`}
            value={condition.channel}
            onChange={(e) =>
              onChange({ branch_condition: { kind: "has_consent", channel: e.target.value as "email" | "sms" } })
            }
            className="mt-1 h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="email">Email</option>
            <option value="sms">Text</option>
          </select>
        </div>
      ) : null}

      {condition?.kind === "source_is" ? (
        <div>
          <Label htmlFor={`${step._key}-source`}>Which place</Label>
          <Input
            id={`${step._key}-source`}
            value={condition.value}
            onChange={(e) => onChange({ branch_condition: { kind: "source_is", value: e.target.value } })}
            className="mt-1"
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${step._key}-true`}>If yes, go to</Label>
          <select
            id={`${step._key}-true`}
            aria-label={`Step ${index + 1} if yes go to`}
            value={step.branchTrueKey ?? ""}
            onChange={(e) => onChange({ branchTrueKey: e.target.value.length > 0 ? e.target.value : null })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="">The next step</option>
            {allSteps.map((s, i) => (
              <option key={s._key} value={s._key}>
                Step {i + 1}: {KIND_LABEL[s.kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${step._key}-false`}>If no, go to</Label>
          <select
            id={`${step._key}-false`}
            aria-label={`Step ${index + 1} if no go to`}
            value={step.branchFalseKey ?? ""}
            onChange={(e) => onChange({ branchFalseKey: e.target.value.length > 0 ? e.target.value : null })}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="">The next step</option>
            {allSteps.map((s, i) => (
              <option key={s._key} value={s._key}>
                Step {i + 1}: {KIND_LABEL[s.kind]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
