"use client"

// components/admin/funnels/FunnelBuilder.tsx — the AI page builder shell.
//
// Chat on the left, live draft preview on the right, one Publish button that
// is a REVIEW rather than a submit. Everything upstream of this file is a pure
// module with tests; this is the first surface a human touches, so it is also
// the first place any of it can be wrong in a way an owner would notice.
//
// ---------------------------------------------------------------------------
// FOUR SIGNALS THE ROUTE RETURNS THAT MUST REACH THE SCREEN. Each one is a
// defect if it does not, and each was found by review in an earlier stage.
// ---------------------------------------------------------------------------
//
// 1. `unresolved` BLOCKS PUBLISH, AND `compile.ok` MUST NOT BE ASKED.
//    A CTA whose ref did not resolve renders as a disabled placeholder — and
//    for `session_pack`, as a live checkout pointed at the wrong thing — and
//    the compiler reports `ok: true, warnings: []` either way, because
//    `<span role="button" aria-disabled>` is perfectly valid markup. The
//    compiler has ZERO signal to give here. So `canPublish` below reads
//    `unresolved.length === 0`; `compile.ok` is only ever consulted as an
//    ADDITIONAL blocker, never as the answer.
//
// 2. `danglingAnchors` WARN AND NEVER BLOCK. A CTA pointing at a `#section`
//    that no longer exists scrolls nowhere. Degraded, not lead-losing — and a
//    campaign page must not be held hostage by it. They are printed in the
//    receipt and in the review; they are absent from `canPublish` on purpose.
//
// 3. `compile.warnings` GO IN THE PRE-PUBLISH REVIEW, NOT A POST-PUBLISH TOAST.
//    FunnelEditor.tsx:182 fires `toast.warning` on the success path, so "your
//    video embed was removed" fades away over a page that is already live.
//    Here the warnings are shown BEFORE the write, and the publish RESULT is a
//    persistent strip rather than a toast that takes the news with it.
//
// 4. A 409 MEANS SOMEONE ELSE MOVED. The revision re-syncs to the one the
//    response carries, the owner is told in a strip that does not
//    auto-dismiss, and PUBLISH IS BLOCKED until a fresh document is in hand —
//    because publishing the doc this tab is holding would silently overwrite
//    the other tab's page. The next chat turn is safe (the route applies ops
//    to the STORED document, so it merges rather than clobbers) and is
//    deliberately left enabled.
//
// ---------------------------------------------------------------------------
// TWO STATE RULES THAT LOOK LIKE PARANOIA AND ARE NOT
// ---------------------------------------------------------------------------
//  * `compile === null` in a response means the turn produced NO document (the
//    model declined, or both attempts failed). Its `unresolved: []` and
//    `danglingAnchors: []` are placeholders, not findings. Adopting them would
//    clear a real blocker and unblock publish on a turn that changed nothing.
//  * `resolutionError !== null` means CTA refs were NOT CHECKED this turn, so
//    its `unresolved: []` means "not checked", never "all clear". The previous
//    list is KEPT. `resolve.ts` says the same thing about itself in capitals.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageSquare,
  Monitor,
  RotateCcw,
  Rocket,
  Smartphone,
  Tablet,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ChatPane } from "./builder/ChatPane"
import { GenerationStage, BUILD_STAGE_WRAPPER_CLASS } from "./builder/GenerationStage"
import { PreviewPane, type PreviewDevice } from "./builder/PreviewPane"
import { PublishReview } from "./builder/PublishReview"
import { SectionInspector } from "./builder/SectionInspector"
import { patchForPath, valueAtPath } from "@/lib/funnels/sections/patch"
import { usePublishStepConnections, useRegisterRepair, useDraftQueue } from "./connections-context"
// THE SENTENCES, SHARED. `publishFunnel` itself is deliberately not used here —
// this screen has a transcript to write a refusal into, which is strictly more
// than a toast can carry — but the wording of a success and the rule for when a
// route's `error` may be shown to an owner belong in one place for all three
// publish surfaces. See the module header.
import { ownerFacingError, publishedSummary } from "./publish-funnel"
import { ImageSlotDialog, type HeroMedia } from "./builder/ImageSlotDialog"
import type { CanvasCommit, CanvasSelection } from "./builder/canvas-editing"
import { candidatePickMessage } from "./builder/format"
import { readTurnStream } from "./builder/stream"
import { fieldsForSection } from "@/lib/funnels/sections/fields"
import type { SectionOp } from "@/lib/funnels/sections/apply"
import type { BuildPhase, Finding } from "@/lib/funnels/sections/build-stream"
import type { StreamedSection } from "@/lib/funnels/sections/stream-progress"
import type { PagePublishProblem } from "@/lib/funnels/publish-plan"
import type {
  BuildErrorResponse,
  BuildTurnResponse,
  BuilderMessage,
  CompileSummary,
  DanglingAnchor,
  RenderForPublish,
  SectionDoc,
  UnresolvedCta,
} from "./builder/types"

export interface FunnelBuilderProps {
  funnelId: string
  funnelName: string
  stepId: string
  stepName: string
  /** Where "open the live page" goes. */
  publicUrl: string
  /**
   * `funnels.status`. Publishing a PAGE and taking the FUNNEL live are two
   * separate actions, and the public `/go/` route serves only `published`
   * funnels — so publishing a page inside a draft funnel writes a real version
   * that still 404s. The owner hit exactly that on production: page published,
   * success reported, `/go/testing` not found, and nothing here mentioned why.
   * Carried so the review can say it BEFORE the write instead of leaving him to
   * infer it from a 404.
   */
  funnelStatus: string
  /**
   * `page` or `funnel`. Same row, same editor — but the owner never asked for a
   * funnel, and being told his landing page "isn't a funnel yet" reads as the
   * wrong screen rather than as a shared implementation.
   */
  funnelKind: string
  initialDoc: SectionDoc | null
  initialRevision: number
  /**
   * `project_data` holds something that is not a `SectionDoc` — legacy
   * GrapesJS state or corruption. NOTHING can repair it through chat, because
   * `applyOps` rejects the document before it looks at a single op.
   */
  docInvalid: boolean
  /** Newest revision whose stored document still parses. Null = none. */
  resetToRevision: number | null
  initialUnresolved: UnresolvedCta[]
  initialDanglingAnchors: DanglingAnchor[]
  initialCompile: CompileSummary | null
  initialResolutionError: string | null
  initialMessages: BuilderMessage[]
  /**
   * The version number the live page is currently serving, or null if this page
   * has never been published.
   *
   * DISPLAY ONLY — it says WHICH snapshot is live, never that the draft still
   * matches it. `lib/db/funnels.ts:getVersionNumber` gives the whole reason;
   * the short version is that proving "unchanged" from stored JSON is not
   * reliable, and a wrong answer would disable Publish on a page that needs it.
   * So a reload always re-arms Publish, and only a publish this tab performed
   * turns the button off.
   */
  initialPublishedVersion?: number | null
  /**
   * First instruction for a page created through the create dialog, composed
   * server-side from the stored name, goal and description.
   *
   * IT IS NEVER TAKEN FROM THE URL. A prompt in the query string survives a
   * refresh, a share and a back button, and would replay over work the owner
   * has since done. Rebuilding it from stored columns means the only thing the
   * URL carries is a nudge (`?start=1`) that the guard below is free to ignore.
   */
  initialPrompt?: string | null
  /**
   * `SECTION_BUILDER_MAX_MESSAGE_LENGTH`, threaded through the server page.
   *
   * THE REASON IT HAD TO BE THREADED IS GONE, AND THE THREADING STAYS. It was
   * threaded because `builder-config.ts` — a module that describes itself as a
   * leaf the UI can read — imported `lib/ai/anthropic`, which constructs an
   * Anthropic provider at module scope, so importing the constant here would
   * have shipped the SDK to the browser. That is CLOSED as of `9d17612e`: the
   * model ids live in `lib/ai/models.ts`, a leaf with zero imports, and
   * `__tests__/lib/funnels/sections/builder-config.test.ts` walks the real
   * import graph so the chain cannot quietly grow the SDK back. A direct import
   * would be safe today.
   *
   * It stays a prop because a component that takes its limits as props is one
   * a test can drive at any limit, and the number still has exactly one
   * definition either way — only the delivery route differs.
   */
  maxMessageLength: number
  /** Server action: `SectionDoc` -> `{html, css}` for the publish route. */
  renderForPublish: RenderForPublish
}

type Busy = "idle" | "building" | "restoring" | "publishing"

/**
 * What the turn in flight has told us so far. Null when nothing is in flight.
 *
 * Held apart from `messages` on purpose: this is the ONLY state that changes
 * many times a second, and merging it into the transcript would re-render every
 * message card on every token.
 */
interface StreamState {
  phase: BuildPhase
  sections: StreamedSection[]
  tokens: { count: number; exact: boolean } | null
  attempt: number
  /**
   * What the review has caught so far.
   *
   * Shown live for one reason: the review adds 30-40 seconds to a first draft,
   * and the difference between dead air and watching six specific problems get
   * named is the whole of whether that wait reads as work. They are progress,
   * not a result — the turn that follows is what actually changed the page —
   * so they live here and vanish with the rest of the stream state.
   */
  findings: Finding[]
}

const INITIAL_STREAM: StreamState = { phase: "reading", sections: [], tokens: null, attempt: 1, findings: [] }

interface PublishResult {
  /**
   * `null` on the funnel-wide path. A funnel-wide publish writes a version row
   * PER PAGE, so there is no single number to report — `pages` carries the
   * count instead. Never `0`: that reads as a version, and "Published version
   * 0" is a lie about a publish that in fact wrote several real ones.
   */
  version: number | null
  warnings: string[]
  /**
   * The page is published but the FUNNEL ROW is still a draft, so `/go/<slug>`
   * still 404s. Reported here rather than in a pre-publish confirmation: it is
   * not a reason to stop, it is the next thing to do, and it comes with the
   * button that does it.
   *
   * Always `false` on the funnel-wide path: that publish takes the funnel row
   * live as part of the same write, so there is nothing left to say.
   */
  notLive: boolean
  /** Set only by `publishFunnel` — how many pages were just published. */
  pages?: number
}

/**
 * The funnel publish route sends `pages` on BOTH its 200 and its 422, carrying
 * a different shape each time — `{stepId, stepName, version}` for what it
 * wrote, `PagePublishProblem` for what it refused.
 *
 * These narrow it at RUN TIME rather than with a cast. A cast would be a claim
 * about a wire format that no compiler is checking on either side, and this
 * repo has already shipped a type that disagreed with the route it described.
 * A malformed row is dropped instead of rendering `undefined` into the chat.
 */
function publishedPages(rows: unknown[]): { stepId: string; version: number }[] {
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return []
    const { stepId, version } = row as Record<string, unknown>
    if (typeof stepId !== "string" || typeof version !== "number") return []
    return [{ stepId, version }]
  })
}

function pagePublishProblems(rows: unknown[]): PagePublishProblem[] {
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return []
    const { stepId, stepName, problems, blank } = row as Record<string, unknown>
    if (typeof stepId !== "string" || typeof stepName !== "string") return []
    if (!Array.isArray(problems) || problems.some((problem) => typeof problem !== "string")) return []
    return [{ stepId, stepName, problems: problems as string[], blank: blank === true }]
  })
}

/**
 * What the owner is told when a funnel publish fails for a reason that was not
 * written for him — a 403 from an expired session, a 500, a dropped connection.
 *
 * One constant because it is the fallback on four branches, and a publish that
 * reported two different sentences for the same non-event would be one more
 * thing to reconcile.
 */
const FUNNEL_PUBLISH_FAILED = "Could not publish. The live funnel is unchanged."

let localMessageSeq = 0
function nextLocalId(prefix: string): string {
  localMessageSeq += 1
  return `${prefix}-${localMessageSeq}`
}

export function FunnelBuilder(props: FunnelBuilderProps) {
  const router = useRouter()

  const [doc, setDoc] = useState<SectionDoc | null>(props.initialDoc)
  const [revision, setRevision] = useState(props.initialRevision)
  const [previewRevision, setPreviewRevision] = useState(props.initialRevision)
  const [unresolved, setUnresolved] = useState(props.initialUnresolved)
  const [danglingAnchors, setDanglingAnchors] = useState(props.initialDanglingAnchors)
  const [compile, setCompile] = useState(props.initialCompile)
  const [resolutionError, setResolutionError] = useState(props.initialResolutionError)
  const [docInvalid, setDocInvalid] = useState(props.docInvalid)
  const [resetToRevision, setResetToRevision] = useState(props.resetToRevision)

  // THE RAIL'S FEED. The rail is a server-rendered sibling in the edit layout,
  // so without this it would be right at mount and wrong from the first edit —
  // wire a button in the inspector and the arrow would not move until a
  // refresh. A no-op outside the layout (tests, the preview harness), so the
  // builder still mounts standalone.
  const publishStepConnections = usePublishStepConnections()
  useEffect(() => {
    publishStepConnections(props.stepId, doc)
  }, [publishStepConnections, props.stepId, doc])

  // A no-op outside a provider (`draftPhase` returns `"idle"` everywhere), so
  // the builder still mounts standalone in tests and in the preview harness.
  const { draftPhase, draftedTurn, startAutoDraft, draftStep } = useDraftQueue()

  /**
   * THE BACKGROUND QUEUE OWNS THIS PAGE RIGHT NOW.
   *
   * Declining to fire our own creation prompt (see the effect below) is only
   * half of what that has to mean. The other half is what the screen SAYS while
   * it is true: with a null document this builder used to show an empty
   * transcript, a blocker reading "There is no page yet. Describe what you want
   * in the chat first." and an ENABLED composer — an explicit invitation to
   * start a second build on a step the queue is already writing, two inches
   * from a rail badge saying `writing…`.
   *
   * Taking that invitation is not harmless. `send` opens a concurrent turn on
   * the same step; one of the two loses the build route's revision check, and
   * if the loser is the queue then `runJob` sees `!response.ok` and paints
   * `draft failed` over a page that was in fact written perfectly well. That is
   * the lying-status-badge class this whole feature exists to remove, produced
   * by the feature itself.
   */
  const queueOwnsThisStep = (() => {
    const phase = draftPhase(props.stepId)
    return phase === "queued" || phase === "writing"
  })()

  const [messages, setMessages] = useState<BuilderMessage[]>(props.initialMessages)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState<Busy>("idle")
  const [stream, setStream] = useState<StreamState | null>(null)

  const [conflict, setConflict] = useState<number | null>(null)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [serverBlockers, setServerBlockers] = useState<string[]>([])

  /**
   * WHAT IS LIVE, AND WHETHER IT IS STILL WHAT THIS TAB IS LOOKING AT.
   *
   * The owner published, the strip said "Published version 1", and the Publish
   * button sat there enabled beside it — so the only reading available was
   * "that did not take, press it again", and pressing it again writes a second
   * identical version row. Two separate facts fix it, and they are separate on
   * purpose:
   *
   *   `publishedVersion` — WHICH version is live. Survives a reload, because
   *   the server reads it off the step row.
   *
   *   `publishedRevision` — the document revision that publish sent. Null at
   *   mount even when a version exists: nothing the server can cheaply read
   *   proves the draft still matches what was published (see the prop's note),
   *   and claiming it did would disable Publish on a page that needs it. So
   *   this is only ever set by a publish THIS TAB watched succeed, and every
   *   later turn moves `revision` past it, which re-arms the button by itself.
   */
  const [publishedVersion, setPublishedVersion] = useState<number | null>(props.initialPublishedVersion ?? null)
  const [publishedRevision, setPublishedRevision] = useState<number | null>(null)
  /**
   * The revision the FUNNEL-WIDE publish sent — see `funnelUpToDate`. Only
   * `publishFunnel` writes it, which is the whole point: publishing one page
   * must not make the funnel control claim the funnel is published.
   */
  const [funnelPublishedRevision, setFunnelPublishedRevision] = useState<number | null>(null)
  /**
   * A publish THIS TAB watched take the funnel row live, so `props.funnelStatus`
   * is now out of date. See `funnelIsDraft`.
   */
  const [wentLive, setWentLive] = useState(false)
  /**
   * The pages a funnel-wide refusal named.
   *
   * Kept so the gate that refusal shut can be REOPENED by the fix it offered.
   * `serverBlockers` is cleared in exactly one other place — `applyTurn` — which
   * only ever runs for THIS step's turns, so a refusal about sibling pages
   * would otherwise be uncleaable from this screen: pressing the "Generate it
   * now" the refusal itself put there drafts the sibling through the provider,
   * which never reaches `applyTurn`, and both publish controls stay disabled
   * until a reload. The per-page 422 path self-heals only because the fix it
   * offers ("Fix it for me") IS a chat turn about this page.
   */
  const [refusedSteps, setRefusedSteps] = useState<string[]>([])

  const [canvasError, setCanvasError] = useState<string | null>(null)

  const [device, setDevice] = useState<PreviewDevice>("desktop")
  const [mode, setMode] = useState<"edit" | "review">("edit")
  const [tab, setTab] = useState<"chat" | "preview">("chat")

  /** What the owner last clicked on the canvas. Selection only, never content. */
  const [selected, setSelected] = useState<CanvasSelection | null>(null)

  /**
   * The revision the NEXT canvas edit must send.
   *
   * A ref, not state, for the reason `DesignEditor` gives: two edits in quick
   * succession must send the revision the FIRST one came back with, and a
   * closure over state would still be holding the value from its own render.
   * Kept in step with `revision` below so a chat turn and a click cannot
   * disagree about what "current" is.
   */
  const editRevision = useRef(props.initialRevision)

  /**
   * Adopts a turn. See the two state rules in the header: a `compile: null`
   * response carries no document and must move nothing but the revision, and a
   * `resolutionError` response must not overwrite `unresolved` with its
   * "not checked" empty list.
   */
  const applyTurn = useCallback((data: BuildTurnResponse) => {
    setRevision(data.revision)
    // The canvas and the chat share one lock, so a chat turn moves the number
    // the next click must send. Forgetting this line is a 409 on the owner's
    // first click after every single AI turn.
    editRevision.current = data.revision
    setConflict(null)

    if (data.compile !== null) {
      if (data.doc) setDoc(data.doc)
      setCompile(data.compile)
      setDanglingAnchors(data.danglingAnchors)
      setResolutionError(data.resolutionError)
      if (data.resolutionError === null) setUnresolved(data.unresolved)
      setDocInvalid(false)
      setServerBlockers([])
      setRefusedSteps([])
      setPreviewRevision(data.revision)
    }

    setMessages((prev) => [
      ...prev,
      {
        // NOT `rev-${data.revision}`: a turn that fails falls back to the
        // revision the user's message got (build/route.ts:824), so a revision
        // can appear on two builder messages and React would then be holding
        // two children with the same key. `nextLocalId` keeps the revision in
        // the id for debugging without letting it be the identity.
        id: nextLocalId(`rev-${data.revision}`),
        role: "builder",
        text: data.reply,
        // Carried so a turn taken in THIS session can be gone back to without a
        // reload. `producedDoc` mirrors the server's rule — a turn is
        // restorable exactly when it wrote a document — and `compile !== null`
        // is this response's own signal for that, per BuildTurnResponse.
        revision: data.revision,
        producedDoc: data.compile !== null && data.doc !== null,
        receipt: data.receipt,
        compile: data.compile,
        danglingAnchors: data.compile !== null ? data.danglingAnchors : [],
        unresolvedCount: data.compile !== null && data.resolutionError === null ? data.unresolved.length : 0,
        resolutionError: data.compile !== null ? data.resolutionError : null,
        blocked: data.blocked,
      },
    ])
  }, [])

  // -------------------------------------------------------------------------
  // The canvas
  //
  // Three functions, and the split between them is the design's governing rule:
  // the canvas reports INTENT (`handleCanvasSelect`, `handleCanvasCommit`), and
  // this component decides what that intent MEANS as an op (`sendOps`). The
  // canvas never holds document state, so there is nothing there to diverge.
  // -------------------------------------------------------------------------

  /**
   * Sends a batch to the non-AI edit route and adopts the result.
   *
   * The SERVER's document is what gets adopted, never a locally-replayed copy:
   * `applyOps` runs there, transactionally, and re-deriving the same result
   * here would be a second implementation of the merge rules to keep in step.
   */
  const sendOps = useCallback(
    async (ops: SectionOp[]) => {
      if (ops.length === 0) return
      setBusy("building")
      setCanvasError(null)
      try {
        const response = await fetch(`/api/admin/funnels/steps/${props.stepId}/edit`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops, revision: editRevision.current }),
        })
        const body = (await response.json().catch(() => null)) as {
          revision?: number
          doc?: SectionDoc
          message?: string
          error?: string
          problems?: string[]
          code?: string
          currentRevision?: number
        } | null

        if (response.status === 409) {
          // Same re-sync rule the chat path uses: move to their revision so the
          // next edit lands on top of their document rather than racing it, and
          // point the preview at what is actually stored.
          const current = body?.currentRevision ?? revision
          setConflict(current)
          setRevision(current)
          editRevision.current = current
          setPreviewRevision(current)
          setCanvasError(body?.error ?? "This page changed in another tab. Reload before editing again.")
          return
        }

        if (!response.ok || typeof body?.revision !== "number" || !body.doc) {
          setCanvasError(body?.problems?.join(" ") ?? body?.error ?? "That change could not be applied.")
          return
        }

        setDoc(body.doc)
        setRevision(body.revision)
        editRevision.current = body.revision
        setPreviewRevision(body.revision)
        setConflict(null)

        // A click edit belongs in the transcript for the same reason an AI turn
        // does: the chat is the record of everything that changed this page,
        // and it is where "go back to here" lives. Without this the edit is
        // invisible — and un-undoable — until a reload.
        if (body.message) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextLocalId(`edit-${body.revision}`),
              role: "owner" as const,
              text: body.message as string,
              revision: body.revision,
              producedDoc: true,
            },
          ])
        }
      } catch {
        setCanvasError("That change could not be saved. Check your connection and try again.")
      } finally {
        setBusy("idle")
      }
    },
    [props.stepId, revision],
  )

  // LENDS THE RAIL THIS PAGE'S WRITER, so its "Connect to <page>" button can
  // act on the one page whose revision this builder is holding. Registered
  // AFTER `sendOps` exists, and through it rather than around it, so a repair
  // takes the same revision check, the same 409 handling and the same
  // transcript turn as any other edit — which is what makes it undoable.
  useRegisterRepair(props.stepId, sendOps)

  const handleCanvasSelect = useCallback((selection: CanvasSelection) => {
    setSelected(selection)
  }, [])

  /** Which media slot the picker is open for, if any. */
  const [imageSlot, setImageSlot] = useState<{ sectionId: string; path: string } | null>(null)

  const handlePickImage = useCallback((target: { sectionId: string; path: string }) => {
    setImageSlot(target)
  }, [])

  const currentMedia = (() => {
    if (!imageSlot || !doc) return null
    const section = doc.sections.find((candidate) => candidate.id === imageSlot.sectionId)
    const value = section ? valueAtPath(section.props, imageSlot.path) : undefined
    return (value ?? null) as HeroMedia | null
  })()

  const chooseMedia = useCallback(
    (media: HeroMedia) => {
      if (!imageSlot || !doc) return
      const section = doc.sections.find((candidate) => candidate.id === imageSlot.sectionId)
      if (!section) return
      setImageSlot(null)
      sendOps([
        {
          op: "update_section",
          id: imageSlot.sectionId,
          props: patchForPath(section.props as Record<string, unknown>, imageSlot.path, media),
        } as SectionOp,
      ])
    },
    [doc, imageSlot, sendOps],
  )

  const removeMedia = useCallback(() => {
    if (!imageSlot || !doc) return
    const section = doc.sections.find((candidate) => candidate.id === imageSlot.sectionId)
    if (!section) return
    setImageSlot(null)
    // `null` is the delete sentinel — `media` is optional, so removing it puts
    // the hero back to no image rather than storing an empty media object.
    sendOps([
      {
        op: "update_section",
        id: imageSlot.sectionId,
        props: patchForPath(section.props as Record<string, unknown>, imageSlot.path, null),
      } as SectionOp,
    ])
  }, [doc, imageSlot, sendOps])

  /**
   * Turns a committed text edit into an `update_section`.
   *
   * THE EMPTY-STRING DECISION LIVES HERE AND NOT IN THE CANVAS, because it
   * depends on the SCHEMA: clearing an optional field means unset it (`null` is
   * `applyOps`'s delete sentinel, the only way to remove a key over JSON),
   * while clearing a required one is not a legal document and is refused
   * locally rather than sent to be refused remotely. The canvas knows neither
   * of those things, and should not.
   */
  const handleCanvasCommit = useCallback(
    (commit: CanvasCommit) => {
      if (!doc) return
      const section = doc.sections.find((candidate) => candidate.id === commit.sectionId)
      if (!section) return

      const field = fieldsForSection(section).find((candidate) => candidate.path === commit.path)

      if (commit.value === "") {
        if (!field?.optional) {
          setCanvasError("That text cannot be left empty.")
          return
        }
        sendOps([{ op: "update_section", id: commit.sectionId, props: { [commit.path]: null } } as SectionOp])
        return
      }

      sendOps([
        {
          op: "update_section",
          id: commit.sectionId,
          props: patchForPath(section.props as Record<string, unknown>, commit.path, commit.value),
        } as SectionOp,
      ])
    },
    [doc, sendOps],
  )

  /** The build route's non-200s, each with the one thing the owner can do. */
  const handleErrorResponse = useCallback(
    (status: number, body: BuildErrorResponse | null) => {
      if (status === 409 || body?.code === "stale_revision") {
        const current = body?.currentRevision ?? revision
        // RE-SYNC, NEVER OVERWRITE. The revision moves to theirs so the next
        // turn lands on top of their document instead of racing it again, and
        // the preview switches to what is actually stored so the owner is not
        // reading a page nobody else can see. `doc` is left stale on purpose —
        // that is exactly why publishing is blocked below until a turn or a
        // reload replaces it.
        setRevision(current)
        setPreviewRevision(current)
        setConflict(current)
        return
      }
      if (status === 422 && body?.code === "doc_invalid") {
        setDocInvalid(true)
        setResetToRevision(body.resetToRevision ?? null)
        return
      }
      toast.error(body?.error ?? "Something went wrong. Nothing was changed.")
    },
    [revision],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (trimmed === "" || busy !== "idle" || docInvalid) return

      const optimisticId = nextLocalId("owner")
      setMessages((prev) => [...prev, { id: optimisticId, role: "owner", text: trimmed }])
      setInput("")
      setBusy("building")
      setMode("edit")
      // A NO-OP ON A WIDE SCREEN, and the point of it on a narrow one. Above
      // `lg` both panes are always on screen and `tab` decides nothing; below
      // it they are tabs, and the build now draws itself in the preview — so
      // without this the owner sends a message on a phone and watches a bare
      // "Working on it…" while the thing he asked for is being drawn on a tab
      // he cannot see. Nothing is lost by moving: the composer is disabled for
      // the duration anyway, and the reply is waiting in the chat afterwards.
      setTab("preview")
      setStream(INITIAL_STREAM)

      const rollback = () => {
        // The route records the owner's message BEFORE spending anything, so a
        // non-200 means nothing was written at all — including the message.
        // Putting the text back in the composer is the honest mirror of that,
        // and it is the difference between "try again" and "retype it".
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId))
        setInput(trimmed)
      }

      try {
        const response = await fetch(`/api/admin/funnels/steps/${props.stepId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, revision }),
        })

        // A JSON body means the route decided the outcome BEFORE it began — a
        // 409, a 422, a rate limit. Same statuses, same bodies and the same
        // handler as when every response was JSON. Branching on `Content-Type`
        // rather than on `response.ok` matters: a `fail` event travels inside a
        // 200, so `ok` alone can no longer tell the two apart.
        const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream")
        if (!isStream) {
          const body = (await response.json().catch(() => null)) as (BuildTurnResponse & BuildErrorResponse) | null
          if (!response.ok || body === null) {
            rollback()
            handleErrorResponse(response.status, body)
            return
          }
          applyTurn(body)
          return
        }

        const outcome = await readTurnStream(response, (event) => {
          setStream((current) => {
            if (!current) return current
            switch (event.type) {
              case "phase":
                return { ...current, phase: event.phase }
              case "usage":
                return { ...current, tokens: { count: event.outputTokens, exact: event.exact } }
              case "restart":
                // The model's first answer was rejected and it is writing the
                // page again. CLEAR rather than append — see the event's own
                // note. The token meter is deliberately kept: those tokens were
                // really spent, and zeroing it would under-report the turn.
                return { ...current, attempt: event.attempt, sections: [], phase: "planning" }
              case "section": {
                const index = current.sections.findIndex((s) => s.key === event.section.key)
                if (index === -1) return { ...current, sections: [...current.sections, event.section] }
                const sections = [...current.sections]
                sections[index] = event.section
                return { ...current, sections }
              }
              case "finding":
                return { ...current, findings: [...current.findings, event.finding] }
              default:
                return current
            }
          })

          // APPLIED THE MOMENT IT ARRIVES, not when the stream ends.
          //
          // The review holds this stream open for another 30-40 seconds AFTER
          // the page is written. Waiting for the terminal outcome would leave
          // the owner watching a progress panel for a page that had already
          // been saved — which is exactly what emitting `result` before the
          // review was designed to avoid on the server side.
          if (event.type === "result" || event.type === "review") {
            applyTurn(event.turn as BuildTurnResponse)
          }
        })

        if (outcome.type === "fail") {
          rollback()
          handleErrorResponse(outcome.status, outcome.body)
          return
        }
        if (outcome.type === "none") {
          // The body ended with no terminal event: a dropped connection, a
          // killed function, a proxy giving up on an idle stream. NOT treated
          // as success — nothing is known about whether the turn was written,
          // so the message goes back in the composer and the owner is told
          // plainly rather than being left with a silently empty turn.
          rollback()
          toast.error("The connection dropped before the page came back. Reload to see if it saved.")
          return
        }
        // Both turns were already applied above as their events arrived. There
        // is deliberately no `applyTurn(outcome.turn)` here: calling it again
        // would append the same builder message to the transcript twice.
      } catch {
        rollback()
        toast.error("Could not reach the page builder. Nothing was changed.")
      } finally {
        setBusy("idle")
        setStream(null)
      }
    },
    [applyTurn, busy, docInvalid, handleErrorResponse, props.stepId, revision],
  )

  /**
   * Polish — run the reviewers over the page as it stands.
   *
   * A review normally rides on a first draft, where the builder wrote every
   * word. This is the way to ask for one on a page that has since been edited.
   * It posts `{action:"polish"}` rather than a message, which is what stops the
   * builder running first and spending a call answering a sentence the owner
   * never typed.
   *
   * No optimistic message and no rollback: nothing of the owner's is at stake
   * here, so a failure has nothing to put back.
   */
  const polish = useCallback(async () => {
    if (busy !== "idle" || docInvalid || doc === null) return

    setBusy("building")
    setMode("edit")
    // Same reason as `send` — the reviewers' findings arrive on the stage,
    // which now lives over the preview.
    setTab("preview")
    setStream({ ...INITIAL_STREAM, phase: "reviewing" })

    try {
      const response = await fetch(`/api/admin/funnels/steps/${props.stepId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "polish", revision }),
      })

      const isStream = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      if (!isStream) {
        const body = (await response.json().catch(() => null)) as BuildErrorResponse | null
        handleErrorResponse(response.status, body)
        return
      }

      const outcome = await readTurnStream(response, (event) => {
        setStream((current) => {
          if (!current) return current
          if (event.type === "phase") return { ...current, phase: event.phase }
          if (event.type === "finding") return { ...current, findings: [...current.findings, event.finding] }
          return current
        })
        if (event.type === "result" || event.type === "review") {
          applyTurn(event.turn as BuildTurnResponse)
        }
      })

      if (outcome.type === "fail") {
        handleErrorResponse(outcome.status, outcome.body)
        return
      }
      if (outcome.type === "none") {
        toast.error("The connection dropped while the page was being reviewed. Reload to see if anything saved.")
      }
    } catch {
      toast.error("Could not reach the reviewer. Nothing was changed.")
    } finally {
      setBusy("idle")
      setStream(null)
    }
  }, [applyTurn, busy, doc, docInvalid, handleErrorResponse, props.stepId, revision])

  /**
   * The way back out of a document no op can repair. `applyOps` rejects an
   * invalid document before inspecting a single op, so no chat instruction can
   * fix one — the only route is to copy an earlier turn's document forward,
   * which is what `{action:"reset"}` does. Without this button an owner whose
   * page got into that state has no way out at all.
   */
  const restore = useCallback(
    async (toRevision: number) => {
      if (busy !== "idle") return
      setBusy("restoring")
      try {
        const response = await fetch(`/api/admin/funnels/steps/${props.stepId}/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset", toRevision }),
        })
        const body = (await response.json().catch(() => null)) as (BuildTurnResponse & BuildErrorResponse) | null

        if (!response.ok || body === null) {
          handleErrorResponse(response.status, body)
          return
        }
        applyTurn(body)
        setDocInvalid(false)
        toast.success(`Restored the page as it was at step ${toRevision}.`)
      } catch {
        toast.error("Could not restore that version.")
      } finally {
        setBusy("idle")
      }
    },
    [applyTurn, busy, handleErrorResponse, props.stepId],
  )

  // --------------------------------------------------------------------------
  // The creation hand-off
  // --------------------------------------------------------------------------

  /**
   * Fire the creation prompt once, and only into a page that has never been
   * built or talked to.
   *
   * THE REF — NOT THE MESSAGE LIST — IS WHAT MAKES IT ONCE. `send` appends the
   * owner's message optimistically, so keying the guard off `messages` would
   * re-enter before that state settled and buy a second paid model turn.
   *
   * Guarding on TURNS as well as the document is the other half, and it is not
   * belt-and-braces: a page whose first build FAILED has a null document beside
   * a real transcript. Checking the document alone would replay the creation
   * prompt over whatever the owner has typed since.
   */
  const initialPromptFired = useRef(false)
  useEffect(() => {
    if (initialPromptFired.current) return
    if (!props.initialPrompt) return
    // THE QUEUE MAY ALREADY BE ON THIS PAGE. `[stepId]/page.tsx` computes
    // `wantsFirstDraft` from "no document and no turns", and the build route
    // writes its turn LAST — so for the whole ~30s of a background draft both
    // are still true, and clicking into that page would start a SECOND build
    // on the same step: two writers racing one optimistic lock, one of them
    // wasted. The provider outlives the navigation, so it is the only thing on
    // the client that knows.
    const phase = draftPhase(props.stepId)
    if (phase === "queued" || phase === "writing") {
      // THE REF IS SPENT, NOT JUST THIS PASS SKIPPED. A bare `return` here
      // leaves the effect ARMED, and it re-runs: `draftPhase` is a
      // `useCallback` over the phase map, so its identity changes on every
      // transition. When the queue FINISHES, `phase` becomes "done" and every
      // remaining guard below is still satisfied — `props.initialDoc` is a
      // PROP, so it is still the `null` the server rendered — and the creation
      // prompt fires about thirty seconds after the page was successfully
      // written. That is the same double build this guard exists to prevent,
      // arriving through a later door.
      //
      // Spending the ref says the true thing: the queue owns this page for
      // this mount, so this mount's creation prompt is done with. It also
      // honours `DraftPhase`'s own rule that a `failed` draft is not retried
      // automatically — "a model refusal repeated automatically is the same
      // refusal at twice the cost". A fresh navigation re-arms it.
      initialPromptFired.current = true
      return
    }
    if (props.initialDoc !== null) return
    if (props.initialMessages.length > 0) return
    initialPromptFired.current = true
    void send(props.initialPrompt)
  }, [props.initialPrompt, props.initialDoc, props.initialMessages, props.stepId, draftPhase, send])

  /**
   * Kicks the background draft queue off once THIS step's first draft has
   * landed.
   *
   * Only off the back of a FIRST draft. A funnel whose pages are all written
   * has nothing queued anyway (the layout composes no jobs for them), but
   * firing this on every turn would mean re-entering `startAutoDraft` on
   * every edit for the whole session.
   *
   * ---------------------------------------------------------------------
   * THIS EFFECT MUST STAY DECLARED AFTER THE `publishStepConnections` ONE.
   * ---------------------------------------------------------------------
   * React runs a component's effects in declaration order, and the queue's
   * skip check reads the graph AT RUN TIME rather than as the layout composed
   * it. On a brand-new templated funnel the layout lists step 1 as a draft job
   * too — it has no way to know this builder is about to write it from
   * `initialPrompt` — so the only thing that stops the queue re-drafting the
   * page the owner just watched succeed is that `publishStepConnections` has
   * already put its document in the graph by the time `startAutoDraft` looks.
   *
   * Move this above that effect and nothing throws, nothing turns red, and
   * every funnel silently costs one extra model call while the page the owner
   * is looking at flips to a red "failed" badge when the two writers race the
   * build route's revision check. The ordering is pinned by
   * "starts the queue only once this page's own draft has reached the graph"
   * in __tests__/components/admin/funnel-publish-all.test.tsx.
   */
  const autoDraftKicked = useRef(false)
  useEffect(() => {
    if (autoDraftKicked.current) return
    if (!props.initialPrompt || doc === null) return
    autoDraftKicked.current = true
    startAutoDraft()
  }, [doc, props.initialPrompt, startAutoDraft])

  /**
   * REOPENS THE GATE A FUNNEL-WIDE REFUSAL SHUT, once one of the pages it named
   * has actually been written.
   *
   * Without this the refusal is a trap: it reports on OTHER pages, its problems
   * go into `serverBlockers`, and the only thing that clears those is
   * `applyTurn` — which runs for this step's turns and nothing else. So the
   * owner presses the "Generate it now" the refusal put in front of him, the
   * sibling page is written perfectly well through the provider, and both
   * publish controls stay disabled until he reloads.
   *
   * Watching the phase rather than clearing on the click is what makes it
   * honest: the gate reopens when a page really has been drafted, not when a
   * button was pressed. The background queue heals it too, for free. A page
   * refused for something OTHER than being blank never reaches "done" here and
   * keeps the gate shut, which is correct — nothing about it has changed.
   */
  useEffect(() => {
    if (refusedSteps.length === 0) return
    if (!refusedSteps.some((stepId) => draftPhase(stepId) === "done")) return
    setServerBlockers([])
    setRefusedSteps([])
  }, [refusedSteps, draftPhase])

  /**
   * ADOPTS THE PAGE THE QUEUE JUST WROTE FOR THIS STEP.
   *
   * Without it the "being written for you" card above is a promise the screen
   * never keeps: this builder holds its own `doc`, seeded from
   * `props.initialDoc` and only ever PUSHED into the provider. The queue writes
   * the provider, which the builder never reads back — so the owner would watch
   * the rail go `writing… → done`, then sit in front of an empty editor until
   * they thought to reload.
   *
   * `applyTurn`, NOT `setDoc`. The queue's turn is a real build turn and the
   * whole of it matters: the REVISION above all (a document adopted beside a
   * stale revision means the owner's next message 409s against a page nobody
   * else touched), and with it the compile summary, the CTA resolution, the
   * dangling anchors and the reply that belongs in the transcript. `applyTurn`
   * is the one definition of "take this turn"; a second, thinner adoption here
   * would be a second thing to keep in step with the route.
   *
   * ONLY INTO A NULL DOCUMENT, and only once. This runs on a step the owner
   * opened while the queue had it — so there is nothing of theirs to overwrite
   * — and the ref makes sure a later phase or turn cannot replay it over work
   * they have done since. A `failed` draft never reaches this, which is right:
   * `DraftPhase` calls `failed` terminal, and the normal creation path is what
   * the page falls back to.
   */
  const adoptedDraft = useRef(false)
  useEffect(() => {
    if (adoptedDraft.current) return
    if (doc !== null) return
    if (draftPhase(props.stepId) !== "done") return
    const turn = draftedTurn(props.stepId)
    // A `done` phase with no turn is a step the queue SKIPPED because the graph
    // already had its document (`startAutoDraft`'s run-time check) — there is
    // nothing to adopt, and the ref is deliberately left armed in case a real
    // draft follows.
    if (!turn) return
    adoptedDraft.current = true
    applyTurn(turn)
  }, [applyTurn, doc, draftPhase, draftedTurn, props.stepId])

  // --------------------------------------------------------------------------
  // The gate
  // --------------------------------------------------------------------------

  /**
   * WHAT STOPS A PUBLISH — AND WHOSE PUBLISH IT STOPS.
   *
   * Two lists out of one pass, because the two publishes on this screen do not
   * ask the same question about this page.
   *
   * `blockers` is about THIS PAGE: everything that would stop
   * `publishThisPage`, which renders the document this tab is holding.
   *
   * `funnelBlockers` is about the FUNNEL, and it is the planner's question
   * instead. `POST /api/admin/funnels/[id]/publish` never looks at this tab's
   * document; it reads every step's STORED draft and applies
   * `funnelPublishPlan` (`lib/funnels/publish-plan.ts:82-94`), whose rule for a
   * doc-less step is: a problem UNLESS it already carries a published version,
   * in which case it is "left alone — neither published nor a problem".
   *
   * THE BUILDER USED TO BE STRICTER THAN THE ROUTE, and the cost was real. On a
   * legacy GrapesJS page `docInvalid` is true and `doc` is null, so the shared
   * list carried "This page's saved content is not something the builder can
   * read." and `canPublishFunnel` was permanently false with the tooltip
   * "Publishing is blocked". The route would have published that funnel without
   * complaint — it skips exactly this step. So standing on a legacy page the
   * owner was told the FUNNEL could not go live and sent to another screen to
   * do it: a small rebuild of the two-screens complaint this branch exists to
   * remove. The spec's justification for gating the funnel button on this
   * page's state (spec:194-197) is sound for an unresolved CTA — that really
   * would be published — and does not hold here.
   */
  const { blockers, funnelBlockers } = useMemo(() => {
    // TRUE OF BOTH PUBLISHES.
    const shared: string[] = []
    if (conflict !== null) {
      shared.push(
        "Someone else changed this page while you had it open. Reload before publishing, or this tab would put its older version back.",
      )
    }
    // compile.ok is an ADDITIONAL blocker, never the answer — see the header.
    if (compile && !compile.ok) shared.push(...compile.problems)
    shared.push(...serverBlockers)

    // THIS PAGE'S OWN STATE.
    //
    // SILENT WHILE THE QUEUE OWNS THE STEP. "There is no page yet. Describe
    // what you want in the chat first." is false in that window — a page is
    // being written, and describing it in the chat is precisely the second
    // build the guard above exists to prevent. The gate stays shut anyway:
    // `doc !== null` is a separate term below, so suppressing the sentence
    // removes a false instruction without opening anything.
    let own: string | null = null
    if (docInvalid) own = "This page's saved content is not something the builder can read."
    else if (!doc && !queueOwnsThisStep) own = "There is no page yet. Describe what you want in the chat first."

    // ...WHICH COUNTS AGAINST THE FUNNEL ONLY WHERE THE PLANNER WOULD COUNT IT.
    const ownBlocksTheFunnel = own !== null && doc === null && publishedVersion === null

    return {
      blockers: own === null ? shared : [own, ...shared],
      funnelBlockers: ownBlocksTheFunnel && own !== null ? [own, ...shared] : shared,
    }
  }, [compile, conflict, doc, docInvalid, publishedVersion, queueOwnsThisStep, serverBlockers])

  /**
   * The live page already IS this document, so there is nothing to publish.
   *
   * Not a blocker and deliberately not in the `blockers` list: a blocker is
   * something wrong that has to be fixed, and this is the opposite — the page
   * is finished. It would read as a failure in the review's "N things are
   * blocking publishing" heading, and there is nothing there to act on.
   */
  const upToDate = publishedRevision !== null && publishedRevision === revision

  /**
   * THE FUNNEL-WIDE PUBLISH HAS ITS OWN "already done", AND IT IS NOT `upToDate`.
   *
   * `publishThisPage` sets `publishedRevision` too, so a shared flag meant that
   * publishing ONE page through the menu turned the primary button into a
   * disabled "✓ Published" — claiming the whole funnel was live, on a funnel
   * whose row may still be `draft`, with the one-click whole-funnel action gone
   * from the screen. That is the owner's original complaint rebuilt inside the
   * control that exists to remove it.
   *
   * Tracked separately, and only `publishFunnel` writes it. It sets
   * `publishedRevision` as well, because a funnel publish really does publish
   * this page — so the funnel going live disarms both, and a page going live
   * disarms only the page.
   */
  const funnelUpToDate = funnelPublishedRevision !== null && funnelPublishedRevision === revision

  /** What both publishes need, before each one's own list and "already done". */
  const publishable = busy === "idle" && unresolved.length === 0

  const canPublish = publishable && blockers.length === 0 && doc !== null && !upToDate

  /**
   * THE FUNNEL GATE'S OWN "is there anything to publish here", and it is the
   * planner's, not this editor's.
   *
   * `doc !== null` alone is the editor's question: can I render this page. The
   * route never asks it — it reads the stored draft — so the honest mirror of
   * `funnelPublishPlan` is "a document OR a published version". That is what
   * lets a funnel go live from a legacy page, and what still keeps the gate
   * shut on a page that has genuinely never been written, including one the
   * background queue is drafting this second.
   */
  const canPublishFunnel =
    publishable &&
    funnelBlockers.length === 0 &&
    (doc !== null || publishedVersion !== null) &&
    !funnelUpToDate

  /**
   * WHAT "Fix N blockers" COUNTS, scoped to the act the primary button performs.
   *
   * Counting this page's list on a funnel would put "Fix 1 blocker" on screen
   * beside an ENABLED "Publish funnel" — and open a review that says one thing
   * is blocking publishing above a Publish now that works. The per-page publish
   * keeps its own explanation on the dropdown's tooltip.
   */
  const isFunnel = props.funnelKind === "funnel"
  const primaryBlockers = isFunnel ? funnelBlockers : blockers
  const blockingCount = primaryBlockers.length + unresolved.length

  /**
   * The funnel itself is not live, so publishing this page will not make it
   * reachable. Not a blocker — the version row is real and correct, and the
   * owner may well be staging a page before flipping the funnel. It is
   * something to SAY, which is a different thing.
   *
   * `props.funnelStatus` IS A PROP AND GOES STALE THE MOMENT WE TAKE THE FUNNEL
   * LIVE. Neither publish reloads the page, so without the second term a
   * successful one-click funnel publish would leave every later review still
   * saying "This funnel isn't live yet — set it to Published" and linking to
   * the separate screen this feature exists to delete. Both publishes report
   * the fact rather than guess it: the funnel route flips the row before it
   * returns 200, and the step route says so with `wentLive`.
   */
  const funnelIsDraft = props.funnelStatus !== "published" && !wentLive

  /**
   * Is there anything the review would actually tell him?
   *
   * WHY THIS EXISTS: publish used to be unconditionally two clicks — `Publish`
   * opened the review, `Publish now` committed. On a clean page the review says
   * "Nothing is blocking this page" and the second click buys nothing, so it
   * reads as pure friction. It is not friction when there IS something to
   * report: warnings must be seen BEFORE the write, because the previous editor
   * showed them after and they faded away over a page that was already live.
   *
   * So: silence earns one click, anything worth saying earns the review.
   */
  const noun = props.funnelKind === "page" ? "landing page" : "funnel"
  /**
   * Back to the tab this row actually lives in — see lib/funnels/admin-path.ts.
   *
   * A LANDING PAGE GOES BACK TO THE LIST, NOT TO ITS OWN DETAIL SCREEN. A
   * landing page is one page, so `/admin/pages/<id>` shows a single card that
   * repeats the card the list already shows — and every control that was once
   * only there (go live, public URL, delete, convert to funnel) now lives on
   * the list card. Leaving the editor onto it meant a second, emptier copy of
   * the screen the owner was trying to get back to.
   *
   * A FUNNEL still goes to its own screen: that one lists the steps, which is
   * information the board cannot show.
   */
  const adminHref =
    props.funnelKind === "page" ? "/admin/pages" : `/admin/funnels/${props.funnelId}`

  /**
   * Things worth SEEING that do not stop a publish: a CTA pointing at a section
   * that no longer exists, something the compiler stripped, CTA refs that could
   * not be checked this turn.
   *
   * THEY NEED THEIR OWN DOOR NOW THAT PUBLISH NO LONGER OPENS THE REVIEW.
   * Removing the confirmation without this would have made every warning
   * invisible until after the write — the review was their only home, and
   * "Fix N blockers" only appears when something actually blocks. So the count
   * gets a quiet outline button beside Publish: available, never in the way.
   */
  // OPTIONAL-CHAINED ON EVERY TERM, and that is not defensiveness for its own
  // sake. `applyTurn` assigns these straight from the turn response, and a
  // response that omits `danglingAnchors` or `compile.warnings` puts UNDEFINED
  // into state — at which point reading `.length` throws during render and the
  // whole builder unmounts into an error boundary. Caught by the initial-prompt
  // test, which drives a turn whose response carries neither.
  const advisoryCount =
    (danglingAnchors?.length ?? 0) +
    (compile?.warnings?.length ?? 0) +
    (resolutionError === null || resolutionError === undefined ? 0 : 1)

  /**
   * PUBLISH PUBLISHES. ONE CLICK, ALWAYS.
   *
   * It used to route through a confirmation whenever there was anything to
   * report, on the reasoning that warnings must be seen BEFORE the write
   * because the previous editor showed them after and they faded away. The
   * first half of that is sound and the second half is no longer true: the
   * publish RESULT is a strip that stays until it is dismissed, not a toast, so
   * nothing is lost by reporting after.
   *
   * What the confirmation actually did in practice was fire on EVERY page,
   * because `funnelIsDraft` is true for every funnel that has not been taken
   * live yet — which is every new one. The owner met a second "Publish now" on
   * his first publish and said: "theres another publish now, i dont want that
   * if i click the publish it should publish now."
   *
   * Blockers are unaffected: `canPublish` still disables the button, and the
   * review is still reachable through "Fix N blockers".
   */

  /**
   * A publish refusal, routed back INTO the chat behind "Fix it for me".
   *
   * ONE AFFORDANCE FOR ONE CLASS OF PROBLEM. The publish route's 422 `problems`
   * and the server action's `blockers` / `problems` are the same kind of thing —
   * something the AI wrote that the AI can rewrite (a page over the size cap, a
   * CTA pointing at a program that has since been deleted). They used to get
   * two different treatments: the 422 went to the chat with a fix button, and
   * the action's refusal landed in `serverBlockers` as an inert bullet list, so
   * the owner was told what was wrong and given nothing to do about it.
   *
   * Callers ALSO set `serverBlockers`, which is what keeps the gate shut — this
   * only adds the way out. `applyTurn` clears that list on the next turn that
   * produces a document.
   */
  const reportRefusal = useCallback((problems: string[]) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextLocalId("problems"),
        role: "problems",
        text: "This page was not published.",
        problems,
      },
    ])
    setMode("edit")
    setTab("chat")
  }, [])

  /**
   * A funnel-wide refusal, routed into the chat WITH the page it is about.
   *
   * `reportRefusal` flattens to strings, which is right when every problem is
   * about the page on screen. A funnel publish reports on four pages at once,
   * and a bare "Thank you has no content yet." leaves the owner to find Thank
   * you themselves. So each problem carries a link, and a merely-blank page
   * carries the fix as well.
   */
  const reportPageRefusal = useCallback((pages: PagePublishProblem[]) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextLocalId("pages"),
        role: "pages",
        text: "This funnel was not published.",
        pages,
      },
    ])
    setMode("edit")
    setTab("chat")
  }, [])

  const publishThisPage = useCallback(async () => {
    if (!doc || !canPublish) return
    setBusy("publishing")
    try {
      const rendered = await props.renderForPublish(doc)
      if (!rendered.ok) {
        // The live publish gate refused. Blockers hold the gate shut; the chat
        // copy carries the fix button. Never a toast over a closed dialog.
        setServerBlockers(rendered.blockers)
        reportRefusal(rendered.blockers)
        return
      }
      if (rendered.problems.length > 0) {
        setServerBlockers(rendered.problems)
        reportRefusal(rendered.problems)
        return
      }

      const response = await fetch(`/api/admin/funnels/steps/${props.stepId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: rendered.html, css: rendered.css, project_data: doc }),
      })
      const body = (await response.json().catch(() => null)) as {
        version?: number
        warnings?: string[]
        problems?: string[]
        error?: string
        /** The route took the landing page live as part of this publish. */
        wentLive?: boolean
      } | null

      if (response.status === 422 && body?.problems?.length) {
        // BACK INTO THE CHAT, BEHIND "Fix it for me". In a chat builder an
        // error the AI can fix must never be a dead-end toast.
        //
        // `setServerBlockers` FIRST, exactly as the server-action refusal path
        // above does it: `reportRefusal` only adds the way OUT, and the comment
        // on it says in as many words that "callers ALSO set `serverBlockers`,
        // which is what keeps the gate shut". This branch used not to, so the
        // route refused and Publish stayed enabled — the owner's next click
        // spent another round trip to be told the same thing. Not a hole (the
        // route refuses again), but a comment and the branch beside it
        // disagreeing is the defect class that produced the missing publish
        // gate in the first place.
        setServerBlockers(body.problems ?? [])
        reportRefusal(body.problems ?? [])
        return
      }
      if (!response.ok || !body?.version) {
        toast.error(body?.error ?? "Could not publish. The live page is unchanged.")
        return
      }

            // `wentLive` comes from the route, which is the only thing that knows
      // whether it flipped the row. `funnelIsDraft` is this tab's stale copy of
      // the status and would keep nagging about a page that is now live.
      setPublishResult({
        version: body.version,
        warnings: body.warnings ?? [],
        notLive: funnelIsDraft && body.wentLive !== true,
      })
      // SAME STALENESS, SAME FIX AS `publishFunnel`. `wentLive` was already
      // consulted for the strip above but never stored, so the review this
      // builder renders a moment later still read `props.funnelStatus` and went
      // on saying "isn't live yet" about a funnel this very publish took live.
      if (body.wentLive === true) setWentLive(true)
      // WHAT IS NOW LIVE. `revision` is read here rather than at the top of the
      // function on purpose: it cannot move while a publish is in flight (every
      // writer is gated on `busy === "idle"`), and reading it at the point of
      // success keeps the pair — the version number and the document it was
      // rendered from — assigned from the same moment.
      setPublishedVersion(body.version)
      setPublishedRevision(revision)
      setMode("edit")
      toast.success(`Published version ${body.version}.`)
    } catch {
      toast.error("Could not publish. The live page is unchanged.")
    } finally {
      setBusy("idle")
    }
  }, [canPublish, doc, props, reportRefusal, revision])

  /**
   * PUBLISH THE WHOLE FUNNEL — the primary action, and one click.
   *
   * The owner published a page, was told it worked, and found a second
   * "Publish funnel" button on the next screen with a 404 behind it until he
   * pressed it: "There should be no seperate publish again, if i publish it in
   * the builder it should publish it now immidately, the whole funnel."
   *
   * It does NOT send this tab's document. The route reads every page's stored
   * draft, gates all of them, and writes only if all pass — so what it
   * publishes is what is SAVED, which is the only thing it could honestly
   * publish for the four pages this tab is not holding. `canPublishFunnel`
   * already requires this page to be saved and clean, and `funnelUpToDate`
   * stops a no-op.
   *
   * NO `!doc` GUARD, and that is the point of `canPublishFunnel` being its own
   * gate. Nothing here reads the document — the route does not want it — so
   * requiring one only reproduced the editor's question ("can I render this
   * page") on an act that never asks it, and locked the funnel publish out of
   * every legacy page. See `funnelBlockers`.
   */
  const publishFunnel = useCallback(async () => {
    if (!canPublishFunnel) return
    setBusy("publishing")
    try {
      const response = await fetch(`/api/admin/funnels/${props.funnelId}/publish`, { method: "POST" })
      const body = (await response.json().catch(() => null)) as {
        published?: number
        /**
         * ONE KEY, TWO SHAPES, AND THE STATUS IS WHAT TELLS THEM APART. On a
         * 200 the route sends `{stepId, stepName, version}` per page it wrote;
         * on a 422 it sends `PagePublishProblem` per page it refused. Typed as
         * `unknown[]` so neither branch can read the other's fields by
         * accident — each narrows it below, inside a branch that has already
         * checked the status.
         */
        pages?: unknown[]
        warnings?: string[]
        error?: string
      } | null

      if (response.status === 422 && body?.pages?.length) {
        const refused = pagePublishProblems(body.pages)
        if (refused.length === 0) {
          // A 422 whose `pages` is not the shape this route documents. Refuse
          // to invent a refusal from it rather than rendering `undefined`.
          toast.error(ownerFacingError(response.status, body?.error, FUNNEL_PUBLISH_FAILED))
          return
        }
        // Same treatment as the step route's 422 — `setServerBlockers` FIRST
        // so the gate stays shut, then the way out. See `reportPageRefusal`.
        setServerBlockers(refused.flatMap((page) => page.problems))
        // WHICH pages, so the effect above can reopen the gate when one of them
        // is written. Without this the fix the refusal offers cannot clear it.
        setRefusedSteps(refused.map((page) => page.stepId).filter((stepId) => stepId !== ""))
        reportPageRefusal(refused)
        return
      }
      // `typeof ... === "number"`, NOT `!body?.published`. An all-legacy-
      // GrapesJS funnel is a real, honest 200 `{published: 0}` —
      // `funnelPublishPlan` (`publish-plan.ts`) skips a step that already
      // carries a compiled version and has no `SectionDoc` to render, so
      // `plan.publish` is legitimately empty and the route still flips the
      // funnel row live. `0` is falsy, so the old check reported that success
      // as "Could not publish. The live funnel is unchanged." while the
      // funnel had, in fact, just gone live — the same defect family as the
      // draft queue calling a failed build "done" (see `runJob`'s own note).
      if (!response.ok || typeof body?.published !== "number") {
        // `ownerFacingError`, NOT `body?.error ?? …`. On a 24-hour session
        // expiry this route answers `{error: "Forbidden"}`, and the owner
        // pressed Publish and read a toast saying "Forbidden". Only 400 and
        // 422 carry a sentence written for him; see the helper.
        toast.error(ownerFacingError(response.status, body?.error, FUNNEL_PUBLISH_FAILED))
        return
      }

      setPublishResult({ version: null, pages: body.published, warnings: body.warnings ?? [], notLive: false })
      // WHAT THE HEADER'S "vN live" PILL NOW HAS TO SAY. A funnel-wide publish
      // wrote a version row for this page too, and the route names it — so
      // leaving the pill on the previous number would have it reporting a
      // snapshot that is no longer being served. Read off the response rather
      // than guessed, and left alone if this step is not in the list (a legacy
      // GrapesJS page is deliberately skipped by the planner).
      const mine = publishedPages(body.pages ?? []).find((page) => page.stepId === props.stepId)
      if (mine) setPublishedVersion(mine.version)
      // BOTH, and that asymmetry is the point. A funnel publish really does
      // publish this page, so it disarms the per-page control too; a page
      // publish sets only `publishedRevision`, so the funnel control stays
      // armed for a funnel that is not live yet.
      setPublishedRevision(revision)
      setFunnelPublishedRevision(revision)
      // THE ROUTE FLIPPED THE ROW BEFORE IT RETURNED 200 — `funnelStatus` is a
      // prop and is now stale. Asserting the fact, not guessing it.
      setWentLive(true)
      setMode("edit")
      // THE SHARED SENTENCE, not a fourth copy of it. `publishedSummary` exists
      // so the funnel detail control, the board's Go live and this builder
      // cannot word the same publish three ways — and this call site was
      // re-typing the literal it was written to own. No `warnings` argument:
      // the result strip below lists them under the headline, and saying them
      // twice on one screen is noise rather than emphasis.
      toast.success(publishedSummary(body.published))
    } catch {
      toast.error(FUNNEL_PUBLISH_FAILED)
    } finally {
      setBusy("idle")
    }
  }, [canPublishFunnel, props.funnelId, props.stepId, reportPageRefusal, revision])

  /**
   * What the review's "Publish now" does — the SAME act as the header's
   * primary button, whichever kind this row is.
   *
   * ONE PRIMARY PUBLISH ACT PER SCREEN. The review is reachable from "N to
   * check" while publishing is still allowed, and it carries a "Publish now"
   * of its own. If that published only this page while the header's button
   * published the funnel, the screen would carry two controls both labelled
   * publish that did different things — which is the complaint that started
   * this feature ("there is two publish, and also a publish now"). It would be
   * worse here than it was then, because the review's own copy says the funnel
   * is not live yet, so the button beside that sentence has to be the one that
   * fixes it. The per-page publish keeps its own door: the split menu.
   */
  // `isFunnel` is declared with the gate above, where `primaryBlockers` needs it.
  const primaryPublish = isFunnel ? publishFunnel : publishThisPage
  /** The gate and the "already done" belonging to whichever act that is. */
  const primaryCanPublish = isFunnel ? canPublishFunnel : canPublish
  const primaryUpToDate = isFunnel ? funnelUpToDate : upToDate

  /**
   * "Generate it now", from a funnel-wide refusal.
   *
   * Wrapped rather than handed `draftStep` raw for one reason the provider
   * cannot cover: `draftStep` is a NO-OP when the layout composed no job for
   * that step — a page with neither a goal nor a template composes no creation
   * prompt, so it is reported blank, offered this button, and the press does
   * nothing at all. A control that silently does nothing reads as a broken
   * app, which is this repo's `silent_gate_reads_as_broken` pattern.
   *
   * The phase is the only observable: a step with a job goes to "writing"
   * synchronously inside `draftStep`, so one settled tick later anything still
   * "idle" was never picked up. Said plainly, with the way forward, rather
   * than left as a dead button.
   */
  const [drafting, setDrafting] = useState<string | null>(null)
  const draftSiblingStep = useCallback(
    (stepId: string) => {
      setDrafting(stepId)
      draftStep(stepId)
    },
    [draftStep],
  )
  useEffect(() => {
    if (drafting === null) return
    const timer = setTimeout(() => {
      if (draftPhase(drafting) === "idle") {
        toast.error("That page can't be written automatically — open it and describe what you want in the chat.")
      }
      setDrafting(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [drafting, draftPhase])

  const pickCandidate = useCallback(
    (cta: UnresolvedCta, candidateName: string) => {
      setMode("edit")
      setTab("chat")
      void send(candidatePickMessage(cta, candidateName))
    },
    [send],
  )

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  /**
   * The preview is never unmounted (see the comment at its call site), so its
   * visibility is a class rather than a branch. `lg:block` must not be attached
   * while the review is open, or it would win over `hidden` on exactly the
   * screens where the review is on screen beside the chat.
   */
  const previewVisibility = mode === "review" ? "hidden" : `${tab === "preview" ? "block" : "hidden"} lg:block`

  const pinned =
    docInvalid || conflict !== null || queueOwnsThisStep ? (
      <div className="space-y-3">
        {/* THE PAGE IS BEING WRITTEN, SO SAY SO.
            Without this card the owner arrives at an empty transcript, a
            composer that invites them to describe a page that is already being
            described, and — until the blocker was suppressed — a sentence
            telling them to do exactly that. The rail two inches away says
            `writing…`. See `queueOwnsThisStep` for what taking the invitation
            actually costs. */}
        {queueOwnsThisStep ? (
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              This page is being written for you
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The rest of this funnel is being drafted one page at a time in the background. It will appear here on its
              own — there is nothing to type, and asking for it again would start a second copy over the top.
            </p>
          </div>
        ) : null}

        {docInvalid ? (
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--error)]">
              <AlertTriangle className="size-4" aria-hidden />
              This page can&apos;t be opened
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Its saved content is either from the old drag-and-drop editor or it has been corrupted. Nothing has been
              lost.
            </p>
            {resetToRevision === null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                There is no earlier version to restore, so this page has to be started over deliberately.
              </p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={busy !== "idle"}
                onClick={() => restore(resetToRevision)}
              >
                <RotateCcw className="size-4" aria-hidden />
                Restore step {resetToRevision}
              </Button>
            )}
          </div>
        ) : null}

        {conflict !== null ? (
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--warning)]">
              <AlertTriangle className="size-4" aria-hidden />
              Someone else changed this page
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing you did was lost and nothing was overwritten. The preview now shows their version (step {conflict}
              ), and your next message will build on it. Publishing is paused until you reload.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => router.refresh()}>
              <RotateCcw className="size-4" aria-hidden />
              Reload the latest version
            </Button>
          </div>
        ) : null}
      </div>
    ) : null

  return (
    // `h-full`, and no `-m-6`. The edit LAYOUT owns both now — it has to, or
    // the step rail would sit inside the admin page padding while the builder
    // escaped it, and the two would not line up. Height comes from the layout's
    // `h-[calc(100dvh-4rem)]` box.
    <div className="flex h-full flex-col">
      {/* Header — h-12 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
        <Link
          href={adminHref}
          className="inline-flex items-center gap-1 truncate text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {props.funnelName}
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-medium text-primary">{props.stepName}</h1>

        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Preview width">
          <DeviceButton
            device="desktop"
            current={device}
            onSelect={setDevice}
            label="Desktop preview"
            icon={<Monitor className="size-4" aria-hidden />}
          />
          <DeviceButton
            device="tablet"
            current={device}
            onSelect={setDevice}
            label="Tablet preview"
            icon={<Tablet className="size-4" aria-hidden />}
          />
          <DeviceButton
            device="mobile"
            current={device}
            onSelect={setDevice}
            label="Mobile preview"
            icon={<Smartphone className="size-4" aria-hidden />}
          />
        </div>

        {/* WHICH VERSION IS LIVE, in the one place that is always on screen.
            It used to be said only in the publish strip — which is dismissible,
            and gone entirely after a reload — so the answer to "did that
            publish, and what is out there now?" lived nowhere. */}
        {publishedVersion !== null ? (
          <span
            className="hidden shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs text-muted-foreground sm:inline"
            title={`The live page is serving version ${publishedVersion}.`}
          >
            v{publishedVersion} live
          </span>
        ) : null}

        <Button asChild variant="ghost" size="sm">
          <a href={props.publicUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden />
            Live page
          </a>
        </Button>

        {blockingCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMode("review")
              setTab("preview")
            }}
          >
            <AlertTriangle className="size-4 text-[var(--error)]" aria-hidden />
            {blockingCount === 1 ? "Fix 1 blocker" : `Fix ${blockingCount} blockers`}
          </Button>
        ) : null}

        {mode !== "review" && blockingCount === 0 && advisoryCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            title="Nothing here stops you publishing — but it is worth a look."
            onClick={() => {
              setMode("review")
              setTab("preview")
            }}
          >
            <AlertTriangle className="size-4 text-[var(--warning)]" aria-hidden />
            {advisoryCount === 1 ? "1 to check" : `${advisoryCount} to check`}
          </Button>
        ) : null}

        {/* Hidden in review mode. It used to stay on screen NEXT TO
            "Publish now", so two publish affordances were visible at once and
            this one was a no-op — its onClick only re-entered the mode it was
            already in. The preview pane above branches on the same condition.

            A FUNNEL GETS A SPLIT BUTTON, A LANDING PAGE DOES NOT. "There
            should be no seperate publish again, if i publish it in the
            builder it should publish it now immidately, the whole funnel,
            also when its a funnel when i click publish you can choose publish
            all or publish steps." A landing page is one page — offering to
            publish it two ways would be noise, and "Publish funnel" on it is
            the wrong-screen wording the owner already objected to once (see
            `noun` above). */}
        {mode === "review" ? null : isFunnel ? (
          <div className="flex items-center">
            <Button
              size="sm"
              className="rounded-r-none"
              // `canPublishFunnel` already requires `busy === "idle"`, so a
              // publish in flight disables this button without a second check.
              disabled={!canPublishFunnel}
              title={
                funnelUpToDate
                  ? "This funnel is live and nothing on this page has changed since. Publish comes back the moment you change something."
                  : canPublishFunnel
                    ? "Publishes the whole funnel immediately."
                    : "Publishing is blocked — open the blockers list to see what needs fixing."
              }
              onClick={() => void publishFunnel()}
            >
              {/* THE SAME SWAP THE LANDING-PAGE BUTTON MAKES, for the same
                  reported reason: "when i publish there is no version showing
                  then the publish button is still available that its
                  confusing". A greyed-out "Publish funnel" sitting beside a
                  strip that says "3 pages published" reads as a publish that
                  did not take. The button says what HAPPENED; there is no act
                  left for it to offer.

                  ON `funnelUpToDate`, NOT `upToDate` — see its definition.
                  `publishThisPage` also moves `publishedRevision`, so reading
                  the shared flag here made publishing ONE page through the menu
                  claim the whole funnel was published and take the one-click
                  whole-funnel action off the screen. */}
              {funnelUpToDate ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Published
                </>
              ) : (
                <>
                  <Rocket className="size-4" aria-hidden />
                  Publish funnel
                </>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={!canPublish}
                  aria-label="More publish options"
                  // SAYS WHY IT IS SHUT. The two gates came apart when the
                  // funnel publish stopped asking this page's question (see
                  // `funnelBlockers`), so this half can now be disabled beside
                  // an enabled primary — and with the page's own blocker out of
                  // the "Fix N blockers" count, a bare grey chevron would be a
                  // control that refuses without saying anything, which this
                  // repo calls `silent_gate_reads_as_broken`.
                  title={
                    canPublish
                      ? "Publish only this page, without taking the funnel live."
                      : upToDate
                        ? `Version ${publishedVersion} is live and this page has not changed since.`
                        : "This page can't be published on its own right now — the funnel publish skips it."
                  }
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void publishThisPage()}>Publish this page only</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            size="sm"
            // `canPublish` already requires `busy === "idle"`, so a publish in
            // flight disables this button without a second check.
            disabled={!canPublish}
            title={
              upToDate
                ? `Version ${publishedVersion} is live and this page has not changed since. Publish comes back the moment you change something.`
                : canPublish
                  ? "Publishes straight away."
                  : "Publishing is blocked — open the blockers list to see what needs fixing."
            }
            onClick={() => void publishThisPage()}
          >
            {/* "Publish" IN EVERY STATE BUT ONE. An earlier attempt swapped this
                to "Review & publish" when a review was pending, on the theory
                that a button should announce which of two things it does. The
                existing tests rejected it, and they were right: the complaint
                that started this was TOO MANY publish affordances, and a label
                that mutates between two names is one more thing to read.
                Publishing through a confirmation is still publishing, so the
                tooltip carries that difference, not the label.
                `upToDate` is not that case. The button is not offering a
                different route to the same act — there is no act left to
                perform — and a greyed-out "Publish" beside a strip saying
                "Published version 1" is exactly the confusion the owner
                reported: it reads as a publish that did not take. */}
            {upToDate ? (
              <>
                <Check className="size-4" aria-hidden />
                Published
              </>
            ) : (
              <>
                <Rocket className="size-4" aria-hidden />
                Publish
              </>
            )}
          </Button>
        )}
      </div>

      {/* A REFUSED CANVAS EDIT, as a strip rather than a toast.
          The canvas reverts nothing on failure - the page simply does not
          change - so without this the owner types, sees no result, and has no
          idea whether the click missed, the save failed, or the app is broken.
          A silent refusal reads as a broken editor. */}
      {canvasError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground">{canvasError}</p>
          <button
            type="button"
            onClick={() => setCanvasError(null)}
            aria-label="Dismiss this message"
            className="text-muted-foreground hover:text-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* The publish RESULT, as a strip that stays put. A toast would take the
          news of what the compiler removed away with it. */}
      {publishResult ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-border bg-surface/60 px-4 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {/* Two publish paths, two facts to report — never both. A
                  funnel-wide publish writes one version row PER PAGE, so
                  there is no single number to name; `pages` carries the count
                  instead. See the ruling on `PublishResult.version` above. */}
              {typeof publishResult.pages === "number"
                ? publishedSummary(publishResult.pages)
                : `Published version ${publishResult.version}. The live page is updated.`}
            </p>
            {publishResult.warnings.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {publishResult.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {/* The one thing left to do, WITH the button that does it. This
                used to be a pre-publish confirmation the owner had to click
                past on every single page; here it arrives after the write,
                where it is the next step rather than an obstacle. */}
            {publishResult.notLive ? (
              <p className="mt-1 text-muted-foreground">
                This {noun} is still a draft, so its public link will not open for anyone yet.{" "}
                <Link
                  href={adminHref}
                  className="text-primary underline underline-offset-2"
                >
                  Take it live
                </Link>
                .
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setPublishResult(null)}
            aria-label="Dismiss publish result"
            className="text-muted-foreground hover:text-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {/* Below lg the sidebar is already hidden and there is no room for two
          panes, so they become tabs rather than a squeeze. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-white px-3 py-1.5 lg:hidden">
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
          <MessageSquare className="size-4" aria-hidden />
          Chat
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          <Monitor className="size-4" aria-hidden />
          Preview
        </TabButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ChatPane
          className={`${tab === "chat" ? "flex" : "hidden"} shrink-0 border-r border-border lg:flex lg:w-[340px] 2xl:w-[400px]`}
          messages={messages}
          maxMessageLength={props.maxMessageLength}
          value={input}
          onChange={setInput}
          onSend={send}
          currentRevision={revision}
          onRestore={restore}
          busy={busy === "building"}
          // AND WHILE THE QUEUE OWNS THIS STEP. An enabled composer here is a
          // literal invitation to open a second build on a page already being
          // written — see `queueOwnsThisStep`. It comes back the moment the
          // draft lands, which is also when there is finally something to
          // change.
          composerDisabled={docInvalid || queueOwnsThisStep}
          pinned={pinned}
          onPolish={polish}
          canPolish={doc !== null && !docInvalid}
          funnelKind={props.funnelKind}
          funnelId={props.funnelId}
          onDraftStep={draftSiblingStep}
        />

        {mode === "review" ? (
          <PublishReview
            className={`${tab === "preview" ? "flex" : "hidden"} min-w-0 flex-1 bg-surface/50 lg:flex`}
            stepId={props.stepId}
            previewRevision={previewRevision}
            doc={doc}
            // THE ACT'S OWN LIST, not this page's. The button in there performs
            // `primaryPublish`, so a heading counting things that do not stop it
            // would sit above a working "Publish now". See `primaryBlockers`.
            blockers={primaryBlockers}
            unresolved={unresolved}
            danglingAnchors={danglingAnchors}
            compileWarnings={compile?.warnings ?? []}
            resolutionError={resolutionError}
            funnelIsDraft={funnelIsDraft}
            noun={noun}
            funnelHref={adminHref}
            publicUrl={props.publicUrl}
            canPublish={primaryCanPublish}
            upToDate={primaryUpToDate}
            publishScope={isFunnel ? "funnel" : "page"}
            publishedVersion={publishedVersion}
            publishing={busy === "publishing"}
            onPublish={primaryPublish}
            onCancel={() => setMode("edit")}
            onPickCandidate={pickCandidate}
          />
        ) : null}

        {/* HIDDEN, NEVER UNMOUNTED. Opening the review and coming back out is a
            round trip an owner makes repeatedly, and a ternary here would tear
            the preview down and rebuild it each way — a cold reload of the
            document, landing them back at the top of the page. That is the
            exact defect the double buffer inside PreviewPane exists to prevent,
            reintroduced one level up. `display: none` keeps the element (and so
            its loaded document) alive; only its box goes away, which is why
            PreviewPane re-measures off a ResizeObserver rather than on mount.

            NOT VERIFIED IN A BROWSER: that the frame's scroll position survives
            display:none in every engine. The document does; the scroll offset
            is the engine's to keep. */}
        <div data-testid="preview-column" className={`${previewVisibility} relative min-w-0 flex-1 overflow-hidden`}>
          <PreviewPane
            className="absolute inset-0 bg-surface/50"
            stepId={props.stepId}
            device={device}
            revision={previewRevision}
            title="Draft preview of this page"
            // Only in edit mode, and never while a turn is in flight: the canvas
            // and the chat write the same document through the same lock, so
            // letting a click land mid-turn would 409 one of them for nothing.
            editable={mode === "edit" && doc !== null && !docInvalid}
            onSelect={handleCanvasSelect}
            onCommit={handleCanvasCommit}
            onPickImage={handlePickImage}
          />

          {/* ------------------------------------------------------------------
              THE TURN IN FLIGHT IS DRAWN OVER THE PAGE, NOT INSIDE THE CHAT.
              ------------------------------------------------------------------
              It lived in the transcript, where it was a 340px-wide card wedged
              between messages — and the owner asked for it here, in the space
              that otherwise says "Nothing to preview yet". He is right about
              more than the aesthetics: the wireframe is a stand-in for the
              PAGE, so the place it belongs is the place the page appears. On a
              first build that area is empty for the whole thirty seconds, which
              is exactly the dead air this display exists to fill.

              An overlay rather than a branch, for the reason the comment above
              gives: the iframe underneath must not unmount. It also stops
              clicks reaching the canvas mid-turn, which the chat and the canvas
              would otherwise 409 each other over.

              The scrim is opaque only when there is nothing behind it. On an
              edit turn the current page stays legible through it — being able
              to see what is being changed while it changes is the whole
              difference between a preview and a loading screen. */}
          {stream ? (
            <div
              data-testid="build-stage"
              className={`absolute inset-0 z-10 flex justify-center overflow-y-auto p-4 lg:p-6 ${
                doc === null ? "bg-surface" : "bg-surface/80 backdrop-blur-[2px]"
              }`}
            >
              <div className={BUILD_STAGE_WRAPPER_CLASS}>
                <GenerationStage
                  phase={stream.phase}
                  sections={stream.sections}
                  tokens={stream.tokens}
                  // The document BEING EDITED, so an `update_section` event —
                  // which names a section by id and carries no kind — can still
                  // be drawn in the right shape.
                  doc={doc}
                  attempt={stream.attempt}
                  findings={stream.findings}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* The inspector, beside the canvas. Hidden below lg for the same
            reason the sidebar is: there is no room for three columns. */}
        {mode === "edit" && doc !== null && !docInvalid ? (
          <SectionInspector
            className={`${tab === "preview" ? "block" : "hidden"} w-80 shrink-0 overflow-y-auto border-l border-border bg-white lg:block`}
            doc={doc}
            selectedId={selected?.sectionId ?? null}
            selectedPath={selected?.path ?? null}
            onOps={sendOps}
            busy={busy !== "idle"}
          />
        ) : null}
      </div>

      <ImageSlotDialog
        open={imageSlot !== null}
        stepId={props.stepId}
        current={currentMedia}
        onClose={() => setImageSlot(null)}
        onChoose={chooseMedia}
        onRemove={removeMedia}
      />
    </div>
  )
}

function DeviceButton({
  device,
  current,
  onSelect,
  label,
  icon,
}: {
  device: PreviewDevice
  current: PreviewDevice
  onSelect: (device: PreviewDevice) => void
  label: string
  icon: ReactNode
}) {
  const active = device === current
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={() => onSelect(device)}
      className={`rounded-md p-1.5 transition-colors ${
        active ? "bg-surface text-primary" : "text-muted-foreground hover:text-primary"
      }`}
    >
      {icon}
    </button>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-surface text-primary" : "text-muted-foreground hover:text-primary"
      }`}
    >
      {children}
    </button>
  )
}
