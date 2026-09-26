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
import {
  ENROLMENT_METADATA_KEYS,
  ENROLMENT_METADATA_MAX_VALUE_LENGTH,
  type EnrolmentMetadataKey,
} from "@/lib/lead-engine/enrolment-metadata"
import { MERGE_FIELD_KEYS, unknownMergeFields } from "@/lib/lead-engine/merge-fields"
import { useStepEditorDirty } from "@/components/admin/sequences/StepEditorDirtyContext"
// G11. The one ceiling, shared with `validateStepList` and the tick so the
// number the box shows is the number the save enforces.
import { WAIT_ANCHOR_MAX_DAYS_BEFORE } from "@/lib/lead-engine/step-config"

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

const BRANCH_KIND_ORDER: BranchCondition["kind"][] = [
  "enrolled_metadata_is",
  "has_phone",
  "has_user",
  "has_consent",
  "source_is",
  "clicked_last_email",
  "opened_last_email",
]

/**
 * The only predicates evaluateBranch implements. Nothing else can be offered
 * here — and because this is a Record over the union, adding a predicate
 * without a label written for a non-programmer is a compile error.
 */
const BRANCH_KIND_LABEL: Record<BranchCondition["kind"], string> = {
  // Spans every key, not just `service`: the predicate also answers who
  // filled the form in, which quiz they took and what they scored. "What they
  // asked for" would hide the parent-versus-athlete split from the coach
  // looking for it.
  enrolled_metadata_is: "Something they told us when they signed up",
  has_phone: "Has a phone number",
  has_user: "Has an account",
  has_consent: "Has agreed to be contacted",
  source_is: "Came from a particular place",
  clicked_last_email: "Clicked a link in the last email",
  opened_last_email: "Opened the last email (see note)",
}

/**
 * The condition a freshly-picked rule starts as — one arm per predicate, and
 * the `never` is the point of the whole function.
 *
 * WHY THIS IS A SWITCH AND NOT AN IF-CHAIN. It used to be an if-chain over
 * `kind: string` with an `else` that set `branch_condition: null`. G09 added
 * two predicates to `BRANCH_KIND_ORDER` and `BRANCH_KIND_LABEL` and not to that
 * chain, so both rendered in the dropdown, labelled correctly, and set NULL
 * when chosen — after which `validateStepList` refused the save with "This
 * split does not say which people go down each side", against the rule the
 * coach had just picked. It was live on production.
 *
 * FOUR GUARDS MISSED IT, and it is worth being precise about why, because the
 * obvious reading is that the guards were weak. They were not: the union, the
 * Zod schema, `KNOWN_BRANCH_KINDS` and `branch-kinds-agree.test.ts` all check
 * that a predicate is DECLARED consistently. A `Record` over the union proves a
 * LABEL exists; none of them proves the condition can be BUILT. That was a
 * fifth place, and `kind: string` is what kept the union from disciplining it.
 *
 * So: narrow to the union at the boundary, and make the exhaustiveness check
 * the compiler's job. An eighth predicate is now a build failure here rather
 * than a dead entry in a dropdown.
 */
function conditionForKind(kind: BranchCondition["kind"]): BranchCondition {
  switch (kind) {
    case "enrolled_metadata_is":
      // Opens on `service`, the key the most front doors write, with the
      // answer blank — which `validateStepList` refuses until it is filled
      // in, so a half-configured rule can never be saved.
      return { kind: "enrolled_metadata_is", key: "service", value: "" }
    case "has_phone":
      return { kind: "has_phone" }
    case "has_user":
      return { kind: "has_user" }
    case "has_consent":
      return { kind: "has_consent", channel: "email" }
    case "source_is":
      return { kind: "source_is", value: "" }
    case "opened_last_email":
      return { kind: "opened_last_email" }
    case "clicked_last_email":
      return { kind: "clicked_last_email" }
    default: {
      const unhandled: never = kind
      throw new Error(`no starting condition for branch predicate: ${String(unhandled)}`)
    }
  }
}

/**
 * What a coach reads instead of the stored key. A Record over
 * `EnrolmentMetadataKey`, so a key added to the allow-list without a
 * plain-language name is a compile error — the same trick
 * `BRANCH_KIND_LABEL` uses.
 */
const ENROLMENT_METADATA_KEY_LABEL: Record<EnrolmentMetadataKey, string> = {
  service: "Which service they asked about",
  role: "Whether a parent or the athlete filled the form in",
  event_kind: "Whether it was a camp or a clinic",
  camp_name: "Which camp or clinic",
  quiz_key: "Which quiz they took",
  branch: "Which quiz result they got",
  tier: "Which quiz level they scored",
  sport: "Which sport they wrote on the application form",
}

/** The answers a coach will nearly always want, shown under the box. */
const ENROLMENT_METADATA_KEY_HINT: Record<EnrolmentMetadataKey, string> = {
  service: "Type one of these exactly: in_person, online, assessment, clinic, camp",
  // Honest about what `parent` means here. The quiz asks "parent or coach" as
  // one answer, so a coach is stored as `parent` — see
  // RPI_QUIZ_NOT_THE_ATHLETE_BRANCH. What this really separates is the athlete
  // themselves from anyone signing up on an athlete's behalf, and a coach
  // reading "parent" needs to be told that before they write the email.
  role: "Type parent or athlete. Anyone signing up on an athlete's behalf counts as parent, including a coach.",
  event_kind: "Type camp or clinic",
  camp_name: "The camp or clinic's name, exactly as you titled it",
  quiz_key: "The short name of the quiz",
  branch: "The result name, for example parent_coach or rebuilder",
  tier: "The level name from the quiz",
  // Honest about what the stored side is: whatever the applicant typed, so
  // "football" will not match someone who wrote "soccer".
  sport: "Type the sport as people write it, for example soccer. Capital letters do not matter, spelling does.",
}

/** Shown under the predicate when one needs a caveat a coach would want. */
const BRANCH_KIND_NOTE: Partial<Record<BranchCondition["kind"], string>> = {
  // The last sentence used to say "anyone who signed up before you added this
  // goes down the no side", which is WRONG and would have had coaches
  // rebuilding sequences for no reason: the answer is recorded when the
  // person first comes in, not when the split is added, so an inquiry from
  // last week matches perfectly. The three groups below are the ones that
  // really cannot match — a run enrolled before this shipped, a contact the
  // coach added by hand (nothing was recorded), and a front door that does
  // not collect the thing being checked.
  enrolled_metadata_is:
    "Use this to send different messages to different people in the same sequence — the ones who " +
    "asked about a camp and the ones who asked about one-to-one coaching, say. Pick what to check, " +
    "then type the answer to look for. It only knows what we recorded when the person first came " +
    "in, so anyone you added to this sequence by hand goes down the “no” side, and so does anyone " +
    "who came in through a form that does not ask.",
  opened_last_email:
    "Counts more people than really read it. Apple Mail and Gmail can open images automatically, " +
    "which looks the same to us as a person opening the email. \u201CClicked a link\u201D is the one to " +
    "trust when it matters.",
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
  /**
   * G11. `sequences.trigger_source`, so the wait step can warn when a
   * countdown cannot work in this sequence. Optional so that the many tests
   * that render this editor without one keep compiling; absent reads as
   * "nothing triggers it", which is the warning-on side.
   */
  triggerSource?: string | null
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
  triggerSource = null,
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
  const { setDirty } = useStepEditorDirty()

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

  // Whole-branch review, Important 2: reported to SequenceSwitch (via
  // StepEditorDirtyContext) so it can ask before a toggle's router.refresh()
  // silently discards whatever is typed here. Compared by VALUE against the
  // server's own copy, not by an isSaving/hasEdited flag, so it reads "no
  // unsaved changes" the instant a save round-trips back to matching content
  // — not just immediately after clicking Save.
  const isDirty = useMemo(() => JSON.stringify(drafts) !== JSON.stringify(initialSteps), [drafts, initialSteps])
  useEffect(() => {
    setDirty(isDirty)
    // Unmounting (e.g. navigating away mid-edit) must not leave a stale
    // "dirty" reading behind for whatever mounts next inside the same
    // provider.
    return () => setDirty(false)
  }, [isDirty, setDirty])

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
            triggerSource={triggerSource}
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
  triggerSource,
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
  /** G11. What starts this sequence — decides whether a countdown can work here. */
  triggerSource: string | null
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
              <MergeFieldNote text={`${step.subject ?? ""}\n${step.body ?? ""}`} />
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
            <MergeFieldNote text={step.body ?? ""} />
          </div>
        ) : null}

        {step.kind === "wait" ? (
          <WaitFields step={step} index={index} triggerSource={triggerSource} onChange={onChange} />
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

/** The default a countdown opens on — the first reminder in the 14/7/3 shape. */
const DEFAULT_DAYS_BEFORE_ANCHOR = 14

/**
 * G11. The `sequences.trigger_source` values that actually supply an anchor.
 *
 * ONE ENTRY TODAY, and it is a fact about the CODE, not a preference: only
 * `app/api/events/[id]/signup/route.ts` and `.../checkout/route.ts` pass
 * `anchorAt` into `captureLead`, and they both do it from `events.start_date`.
 * Every other front door leaves `sequence_runs.anchor_at` null, so an
 * anchored wait in one of their sequences ends every run at that step with
 * `not_anchored`.
 *
 * Add to this list ONLY when a route actually starts supplying an anchor —
 * a source named here without a writer turns a true warning into a false
 * reassurance, which is worse than no warning at all.
 */
const SEQUENCE_SOURCES_WITH_AN_ANCHOR = new Set(["event_signup"])

/**
 * G11. A wait says either HOW LONG or WHEN, and this is where a coach chooses.
 *
 * TWO MODES, ONE STORED SHAPE. "After the last step" is `wait_minutes` and an
 * empty `config`; "Before the event" is `config.wait_until` and a NULL
 * `wait_minutes`. Switching clears the other one rather than leaving it
 * behind, because the tick ignores `wait_minutes` entirely once `wait_until`
 * is present — a leftover 60 would sit in the row reading like the answer
 * while changing nothing. Migration 00268 only stops a wait having NEITHER,
 * so the database would happily keep both; this is the only thing that does
 * not.
 *
 * The days box is allowed to be EMPTY while a coach is typing, which stores
 * `{}` under `wait_until` and makes `validateStepList` refuse the save. That
 * is the same shape the metadata branch uses for its blank answer: visible,
 * blocking, and impossible to save half-finished.
 */
/**
 * What the reader will actually see where a `{{token}}` sits.
 *
 * WRITTEN FOR A COACH, NOT A PROGRAMMER — no "merge field", no "placeholder",
 * no "token". A person typing `{{sport}}` into a subject line has a perfectly
 * reasonable expectation, and the only useful thing to tell them is that it
 * will come out blank and which words do work.
 *
 * ADVISORY, NOT A SAVE GATE. A blank is already the safe outcome (the reader
 * never sees braces), so refusing the save would block a coach whose sequence
 * is otherwise finished, over something that costs a slightly plain sentence.
 * It also updates as they type, which beats telling them at save time.
 */
function MergeFieldNote({ text }: { text: string }) {
  const unknown = unknownMergeFields(text)
  if (unknown.length === 0) return null
  return (
    <p className="mt-1 text-xs text-accent">
      {unknown.map((name) => `"{{${name}}}"`).join(", ")} will come out blank — nothing fills{" "}
      {unknown.length === 1 ? "it" : "them"} in. The words you can use are{" "}
      {MERGE_FIELD_KEYS.map((key) => `{{${key}}}`).join(", ")}.
    </p>
  )
}

function WaitFields({
  step,
  index,
  triggerSource,
  onChange,
}: {
  step: EditableStep
  index: number
  triggerSource: string | null
  onChange: (patch: Partial<EditableStep>) => void
}) {
  const waitUntil = step.config.wait_until
  // `!== undefined` ONLY, matching `parseWaitConfig`'s own test exactly.
  //
  // An earlier version also excluded null, which put the two out of step: a
  // stored `{"wait_until": null}` rendered the MINUTES box while the parser
  // called it a malformed anchor, so Save was blocked by a sentence about a
  // field that was not on screen, and selecting "after" while it already read
  // "after" fires no change event — leaving no way out of the error. Not
  // reachable from this UI, but reachable from a hand-edited row or an older
  // client, and "the editor and the tick must reject exactly the same shapes"
  // is the rule `step-config.ts`'s header is built on.
  const isAnchored = waitUntil !== undefined
  const days =
    typeof (waitUntil as { days_before_anchor?: unknown } | undefined)?.days_before_anchor === "number"
      ? String((waitUntil as { days_before_anchor: number }).days_before_anchor)
      : ""

  function setMode(mode: string) {
    if (mode === "before_event") {
      onChange({ wait_minutes: null, config: { wait_until: { days_before_anchor: DEFAULT_DAYS_BEFORE_ANCHOR } } })
    } else {
      // Back to a usable ordinary wait. Restoring the 60-minute default
      // rather than null matters: a wait with neither is refused by
      // validateStepList, so leaving it empty would trap the coach behind an
      // error produced by the act of changing their mind.
      onChange({ wait_minutes: 60, config: {} })
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${step._key}-wait-mode`}>When to send</Label>
        <select
          id={`${step._key}-wait-mode`}
          aria-label={`Step ${index + 1} when to send`}
          value={isAnchored ? "before_event" : "after"}
          onChange={(e) => setMode(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground sm:w-72"
        >
          <option value="after">Wait a length of time</option>
          <option value="before_event">A set number of days before the event</option>
        </select>
      </div>

      {isAnchored ? (
        <div>
          <Label htmlFor={`${step._key}-wait-days`}>How many days before the event</Label>
          <Input
            id={`${step._key}-wait-days`}
            type="number"
            min={0}
            // The same ceiling `parseWaitConfig` enforces. Without it the
            // field accepted 3650 and then Save was blocked by a sentence
            // naming a limit the box had never mentioned — the browser now
            // says so at the point of typing. `max` is a hint, not a
            // guarantee (it does not stop a pasted value), so the parser
            // remains the real check.
            max={WAIT_ANCHOR_MAX_DAYS_BEFORE}
            value={days}
            onChange={(e) =>
              onChange({
                config:
                  e.target.value === ""
                    ? { wait_until: {} }
                    : { wait_until: { days_before_anchor: Number(e.target.value) } },
              })
            }
            className="mt-1 w-32"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Counts back from the start of the camp or clinic the person signed up for. Everybody gets this message at
            the same moment, whenever they signed up. If someone signs up after this moment has already gone, they skip
            it — and anything else waiting on it — and carry on from the next message that is still ahead. Anyone you
            added to this sequence by hand has no event date, so their follow-up stops here.
          </p>
          {!SEQUENCE_SOURCES_WITH_AN_ANCHOR.has(triggerSource ?? "") ? (
            <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              <strong>This follow-up does not start from a camp or clinic signup,</strong> so nobody in it has an event
              date to count back from. If you save this, everyone in this follow-up will stop at this step and get
              nothing after it. Use “Wait a length of time” here instead, unless you are about to change what starts
              this follow-up.
            </p>
          ) : null}
          {triggerSource !== null && SEQUENCE_SOURCES_WITH_AN_ANCHOR.has(triggerSource) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              People already part-way through this follow-up who joined before today have no event date saved, so they
              will stop here too.
            </p>
          ) : null}
        </div>
      ) : (
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
      )}
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

  function setConditionKind(raw: string) {
    // `raw` is a DOM value, so it is `string` and could be anything. Narrow it
    // against the list actually offered, THEN build exhaustively: the empty
    // "Choose one…" option is the only legitimate way to reach null.
    const known = BRANCH_KIND_ORDER.find((k) => k === raw)
    onChange({ branch_condition: known ? conditionForKind(known) : null })
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

      {condition && BRANCH_KIND_NOTE[condition.kind] ? (
        <p className="text-xs text-muted-foreground">{BRANCH_KIND_NOTE[condition.kind]}</p>
      ) : null}

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

      {condition?.kind === "enrolled_metadata_is" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${step._key}-meta-key`}>What to check</Label>
            <select
              id={`${step._key}-meta-key`}
              aria-label={`Step ${index + 1} what to check`}
              value={condition.key}
              onChange={(e) =>
                onChange({
                  branch_condition: {
                    kind: "enrolled_metadata_is",
                    key: e.target.value as EnrolmentMetadataKey,
                    value: condition.value,
                  },
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground"
            >
              {ENROLMENT_METADATA_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ENROLMENT_METADATA_KEY_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`${step._key}-meta-value`}>Answer to look for</Label>
            <Input
              id={`${step._key}-meta-value`}
              aria-label={`Step ${index + 1} answer to look for`}
              // The save route answers a flat "Invalid request body." with no
              // field named, so an over-long answer would reach the coach as
              // an unactionable 400 after an enabled Save. `validateStepList`
              // also refuses it in English; this stops it being typed.
              maxLength={ENROLMENT_METADATA_MAX_VALUE_LENGTH}
              value={condition.value}
              onChange={(e) =>
                onChange({
                  branch_condition: { kind: "enrolled_metadata_is", key: condition.key, value: e.target.value },
                })
              }
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">{ENROLMENT_METADATA_KEY_HINT[condition.key]}</p>
          </div>
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
