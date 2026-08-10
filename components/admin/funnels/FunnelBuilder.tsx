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

import { useCallback, useMemo, useState, type ReactNode } from "react"
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
import { PreviewPane, type PreviewDevice } from "./builder/PreviewPane"
import { PublishReview } from "./builder/PublishReview"
import { candidatePickMessage } from "./builder/format"
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

  const [conflict, setConflict] = useState<number | null>(null)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [serverBlockers, setServerBlockers] = useState<string[]>([])

  const [device, setDevice] = useState<PreviewDevice>("desktop")
  const [mode, setMode] = useState<"edit" | "review">("edit")
  const [tab, setTab] = useState<"chat" | "preview">("chat")

  /**
   * Adopts a turn. See the two state rules in the header: a `compile: null`
   * response carries no document and must move nothing but the revision, and a
   * `resolutionError` response must not overwrite `unresolved` with its
   * "not checked" empty list.
   */
  const applyTurn = useCallback((data: BuildTurnResponse) => {
    setRevision(data.revision)
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
        unresolvedCount:
          data.compile !== null && data.resolutionError === null ? data.unresolved.length : 0,
        resolutionError: data.compile !== null ? data.resolutionError : null,
        blocked: data.blocked,
      },
    ])
  }, [])

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
        const body = (await response.json().catch(() => null)) as
          | (BuildTurnResponse & BuildErrorResponse)
          | null

        if (!response.ok || body === null) {
          rollback()
          handleErrorResponse(response.status, body)
          return
        }
        applyTurn(body)
      } catch {
        rollback()
        toast.error("Could not reach the page builder. Nothing was changed.")
      } finally {
        setBusy("idle")
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
        const body = (await response.json().catch(() => null)) as
          | (BuildTurnResponse & BuildErrorResponse)
          | null

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

  const canPublish =
    busy === "idle" && unresolved.length === 0 && blockers.length === 0 && doc !== null

  const blockingCount = blockers.length + unresolved.length

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
  const previewVisibility =
    mode === "review" ? "hidden" : `${tab === "preview" ? "block" : "hidden"} lg:block`

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
              Its saved content is either from the old drag-and-drop editor or it has been corrupted.
              Nothing has been lost.
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
              Nothing you did was lost and nothing was overwritten. The preview now shows their version
              (step {conflict}), and your next message will build on it. Publishing is paused until you
              reload.
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

        <Button
          size="sm"
          disabled={!canPublish}
          title={
            canPublish
              ? undefined
              : "Publishing is blocked — open the blockers list to see what needs fixing."
          }
          onClick={() => {
            setMode("review")
            setTab("preview")
          }}
        >
          <Rocket className="size-4" aria-hidden />
          Publish
        </Button>
      </div>

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
        />
      </div>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
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
