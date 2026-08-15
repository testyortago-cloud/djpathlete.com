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
  ExternalLink,
  MessageSquare,
  Monitor,
  RotateCcw,
  Rocket,
  Smartphone,
  Tablet,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatPane } from "./builder/ChatPane"
import { GenerationStage } from "./builder/GenerationStage"
import { PreviewPane, type PreviewDevice } from "./builder/PreviewPane"
import { PublishReview } from "./builder/PublishReview"
import { SectionInspector } from "./builder/SectionInspector"
import { patchForPath, valueAtPath } from "./builder/section-patch"
import { ImageSlotDialog, type HeroMedia } from "./builder/ImageSlotDialog"
import type { CanvasCommit, CanvasSelection } from "./builder/canvas-editing"
import { candidatePickMessage } from "./builder/format"
import { readTurnStream } from "./builder/stream"
import { fieldsForSection } from "@/lib/funnels/sections/fields"
import type { SectionOp } from "@/lib/funnels/sections/apply"
import type { BuildPhase } from "@/lib/funnels/sections/build-stream"
import type { StreamedSection } from "@/lib/funnels/sections/stream-progress"
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
}

const INITIAL_STREAM: StreamState = { phase: "reading", sections: [], tokens: null, attempt: 1 }

interface PublishResult {
  version: number
  warnings: string[]
}

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

  const [messages, setMessages] = useState<BuilderMessage[]>(props.initialMessages)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState<Busy>("idle")
  const [stream, setStream] = useState<StreamState | null>(null)

  const [conflict, setConflict] = useState<number | null>(null)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [serverBlockers, setServerBlockers] = useState<string[]>([])

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
      } catch {
        setCanvasError("That change could not be saved. Check your connection and try again.")
      } finally {
        setBusy("idle")
      }
    },
    [props.stepId, revision],
  )

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
              default:
                return current
            }
          })
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
        applyTurn(outcome.turn)
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
    if (props.initialDoc !== null) return
    if (props.initialMessages.length > 0) return
    initialPromptFired.current = true
    void send(props.initialPrompt)
  }, [props.initialPrompt, props.initialDoc, props.initialMessages, send])

  // --------------------------------------------------------------------------
  // The gate
  // --------------------------------------------------------------------------

  const blockers = useMemo(() => {
    const list: string[] = []
    if (docInvalid) {
      list.push("This page's saved content is not something the builder can read.")
    } else if (!doc) {
      list.push("There is no page yet. Describe what you want in the chat first.")
    }
    if (conflict !== null) {
      list.push(
        "Someone else changed this page while you had it open. Reload before publishing, or this tab would put its older version back.",
      )
    }
    // compile.ok is an ADDITIONAL blocker, never the answer — see the header.
    if (compile && !compile.ok) list.push(...compile.problems)
    list.push(...serverBlockers)
    return list
  }, [compile, conflict, doc, docInvalid, serverBlockers])

  const canPublish = busy === "idle" && unresolved.length === 0 && blockers.length === 0 && doc !== null

  const blockingCount = blockers.length + unresolved.length

  /**
   * The funnel itself is not live, so publishing this page will not make it
   * reachable. Not a blocker — the version row is real and correct, and the
   * owner may well be staging a page before flipping the funnel. It is
   * something to SAY, which is a different thing.
   */
  const funnelIsDraft = props.funnelStatus !== "published"

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
  const reviewHasSomethingToSay =
    blockingCount > 0 ||
    danglingAnchors.length > 0 ||
    (compile?.warnings.length ?? 0) > 0 ||
    resolutionError !== null ||
    funnelIsDraft

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

  const publish = useCallback(async () => {
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

      setPublishResult({ version: body.version, warnings: body.warnings ?? [] })
      setMode("edit")
      toast.success(`Published version ${body.version}.`)
    } catch {
      toast.error("Could not publish. The live page is unchanged.")
    } finally {
      setBusy("idle")
    }
  }, [canPublish, doc, props, reportRefusal])

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
    docInvalid || conflict !== null ? (
      <div className="space-y-3">
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
    <div className="-m-6 flex h-[calc(100dvh-4rem)] flex-col">
      {/* Header — h-12 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
        <Link
          href={`/admin/funnels/${props.funnelId}`}
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

        {/* Hidden in review mode. It used to stay on screen NEXT TO
            "Publish now", so two publish affordances were visible at once and
            this one was a no-op — its onClick only re-entered the mode it was
            already in. The preview pane above branches on the same condition. */}
        {mode === "review" ? null : (
          <Button
            size="sm"
            // `canPublish` already requires `busy === "idle"`, so a publish in
            // flight disables this button without a second check.
            disabled={!canPublish}
            title={
              !canPublish
                ? "Publishing is blocked — open the blockers list to see what needs fixing."
                : reviewHasSomethingToSay
                  ? "There's something to check before this goes live."
                  : "Publishes straight away — nothing needs reviewing."
            }
            onClick={() => {
              // Nothing to report: commit on this click. Anything to report:
              // show it BEFORE the write, never after.
              if (!reviewHasSomethingToSay) {
                void publish()
                return
              }
              setMode("review")
              setTab("preview")
            }}
          >
            <Rocket className="size-4" aria-hidden />
            {/* ALWAYS "Publish". An earlier attempt swapped this to
                "Review & publish" when a review was pending, on the theory that
                a button should announce which of two things it does. The
                existing tests rejected it, and they were right: the complaint
                that started this was TOO MANY publish affordances, and a label
                that mutates between two names is one more thing to read. The
                button means "publish this page" in both cases; sometimes that
                routes through a confirmation because there is something to
                show. The tooltip carries the difference. */}
            Publish
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
              Published version {publishResult.version}. The live page is updated.
            </p>
            {publishResult.warnings.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {publishResult.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
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
          busy={busy === "building"}
          composerDisabled={docInvalid}
          pinned={pinned}
          stage={
            stream ? (
              <GenerationStage
                phase={stream.phase}
                sections={stream.sections}
                tokens={stream.tokens}
                // The document BEING EDITED, so an `update_section` event —
                // which names a section by id and carries no kind — can still
                // be drawn in the right shape.
                doc={doc}
                attempt={stream.attempt}
              />
            ) : null
          }
        />

        {mode === "review" ? (
          <PublishReview
            className={`${tab === "preview" ? "flex" : "hidden"} min-w-0 flex-1 bg-surface/50 lg:flex`}
            stepId={props.stepId}
            previewRevision={previewRevision}
            doc={doc}
            blockers={blockers}
            unresolved={unresolved}
            danglingAnchors={danglingAnchors}
            compileWarnings={compile?.warnings ?? []}
            resolutionError={resolutionError}
            funnelIsDraft={funnelIsDraft}
            funnelHref={`/admin/funnels/${props.funnelId}`}
            publicUrl={props.publicUrl}
            canPublish={canPublish}
            publishing={busy === "publishing"}
            onPublish={publish}
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
        <PreviewPane
          className={`${previewVisibility} min-w-0 flex-1 overflow-hidden bg-surface/50`}
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
