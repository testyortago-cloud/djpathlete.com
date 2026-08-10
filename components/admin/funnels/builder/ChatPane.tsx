"use client"

// components/admin/funnels/builder/ChatPane.tsx — the transcript and composer.
//
// The chat is the whole interface for a non-engineer, so two things here carry
// more weight than they look like they do:
//
//  1. THE EMPTY STATE. A blank textarea labelled "describe your page" is a
//     wall. Five starter chips turn it into a menu, and each one is a complete
//     first message rather than a topic.
//
//  2. THE DIFF RECEIPT. The trust problem with a chat page-builder is
//     epistemic: the owner cannot see what moved, so every turn is an act of
//     faith. `Changed: Hero (headline size). Untouched: 8 sections.` is the
//     cheapest possible fix and it is printed after every turn that produced a
//     document, including the ones where the answer is "nothing".

import { useEffect, useRef, type ReactNode } from "react"
import { AlertTriangle, Link2Off, Loader2, Send, Sparkles, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatReceipt, fixPublishProblemsMessage } from "./format"
import type { BuilderMessage } from "./types"

/**
 * Five complete first messages, not five topics. Each names the page TYPE and
 * the offer, because those are the two things the model cannot guess and the
 * owner always knows.
 */
export const BUILDER_STARTERS = [
  "Landing page for a summer camp",
  "Opt-in page for a free guide",
  "Sales page for my 12-week program",
  "Thank-you page after someone books a call",
  "Waitlist page for a new class",
] as const

interface ChatPaneProps {
  className?: string
  messages: BuilderMessage[]
  /** From `builder-config.ts`, threaded through the page — see FunnelBuilder. */
  maxMessageLength: number
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  busy: boolean
  /** Set when the draft cannot be read at all; the composer would be useless. */
  composerDisabled?: boolean
  /** Pinned above the transcript: the unreadable-document recovery, conflicts. */
  pinned?: ReactNode
  /**
   * What to show while a turn is in flight — `GenerationStage`, holding the
   * live wireframe.
   *
   * Passed in rather than built here because the stream state belongs to
   * whoever owns the fetch, and threading four rapidly-changing values through
   * this component only to hand them straight back down would make the
   * transcript re-render on every token. `ChatPane` stays a dumb transcript.
   */
  stage?: ReactNode
}

export function ChatPane({
  className,
  messages,
  maxMessageLength,
  value,
  onChange,
  onSend,
  busy,
  composerDisabled,
  pinned,
  stage,
}: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // `scrollTop = scrollHeight` rather than `scrollTo` — jsdom implements the
    // property but not the method, and this needs no smooth behaviour.
    el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const canSend = !busy && !composerDisabled && value.trim().length > 0

  return (
    <div className={`flex min-h-0 flex-col bg-white ${className ?? ""}`}>
      {pinned ? <div className="border-b border-border p-3">{pinned}</div> : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <div>
                <h2 className="font-heading text-sm text-primary">What is this page for?</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Describe it in a sentence. You can change anything afterwards by asking.
                </p>
              </div>
            </div>
            <ul className="space-y-2">
              {BUILDER_STARTERS.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    disabled={busy || composerDisabled}
                    onClick={() => onSend(starter)}
                    className="w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-sm text-foreground shadow-sm transition-colors hover:border-accent hover:bg-surface/50 disabled:opacity-50"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageCard key={message.id} message={message} onSend={onSend} busy={busy} />
        ))}

        {/* The turn in flight. `stage` is the live wireframe; the bare line
            below it is the fallback for a caller that has none to give, which
            is what this whole area used to be. */}
        {busy
          ? (stage ?? (
              <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Working on it…
              </p>
            ))
          : null}
      </div>

      <div className="border-t border-border p-3">
        <label htmlFor="builder-composer" className="sr-only">
          Describe the change you want
        </label>
        <textarea
          id="builder-composer"
          value={value}
          maxLength={maxMessageLength}
          disabled={composerDisabled}
          rows={3}
          placeholder="Make the headline shorter and add a second testimonial…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (canSend) onSend(value)
            }
          }}
          className="w-full resize-none rounded-xl border border-border bg-white p-2 text-sm shadow-sm outline-none focus-visible:border-accent disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {value.length > maxMessageLength * 0.8
              ? `${value.length} / ${maxMessageLength}`
              : "Enter to send · Shift+Enter for a new line"}
          </span>
          <Button size="sm" disabled={!canSend} onClick={() => onSend(value)}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageCard({
  message,
  onSend,
  busy,
}: {
  message: BuilderMessage
  onSend: (text: string) => void
  busy: boolean
}) {
  if (message.role === "owner") {
    return (
      <div className="ml-6 rounded-xl border border-border bg-surface/60 p-3 text-sm shadow-sm">
        <p className="whitespace-pre-wrap text-foreground">{message.text}</p>
      </div>
    )
  }

  // A publish refusal, kept IN the chat with the button that fixes it. The old
  // editor made this a toast, which is a dead end: the owner is told the page
  // was refused and given nothing to do about it.
  if (message.role === "problems") {
    return (
      <div className="rounded-xl border border-border bg-white p-3 text-sm shadow-sm">
        <p className="flex items-center gap-2 font-medium text-[var(--error)]">
          <AlertTriangle className="size-4" aria-hidden />
          {message.text}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {message.problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={() => onSend(fixPublishProblemsMessage(message.problems))}
        >
          <Wrench className="size-4" aria-hidden />
          Fix it for me
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-white p-3 text-sm shadow-sm">
      <p className="whitespace-pre-wrap text-foreground">{message.text}</p>

      {message.receipt ? (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {message.receipt.isRewrite ? (
            <span className="mr-1 rounded bg-[var(--warning)]/15 px-1.5 py-0.5 font-medium text-foreground">
              Rewrote most of the page
            </span>
          ) : null}
          {formatReceipt(message.receipt)}
        </p>
      ) : null}

      {message.unresolvedCount ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--error)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {message.unresolvedCount === 1
            ? "1 button doesn't point at anything yet. Publishing is blocked until it does."
            : `${message.unresolvedCount} buttons don't point at anything yet. Publishing is blocked until they do.`}
        </p>
      ) : null}

      {/* Dangling anchors are reported, never escalated: a dead in-page link
          scrolls nowhere, which is degraded, not lead-losing. */}
      {message.danglingAnchors && message.danglingAnchors.length > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Link2Off className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {message.danglingAnchors.length === 1
            ? "1 link jumps to a section that isn't on this page. It won't stop you publishing."
            : `${message.danglingAnchors.length} links jump to sections that aren't on this page. They won't stop you publishing.`}
        </p>
      ) : null}

      {message.resolutionError ? <p className="mt-2 text-xs text-[var(--warning)]">{message.resolutionError}</p> : null}

      {message.compile && message.compile.warnings.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {message.compile.warnings.length === 1
            ? "1 thing will be removed when this publishes — review it before you publish."
            : `${message.compile.warnings.length} things will be removed when this publishes — review them before you publish.`}
        </p>
      ) : null}
    </div>
  )
}
