"use client"

// components/public/AskPanel.tsx — the conversation, shared by both surfaces:
// the panel the sticky bar opens, and the full page at /ask.
//
// WHAT THIS COMPONENT IS NOT ALLOWED TO DO
//
//   * It does not post history. `askRequestSchema` has two fields and no
//     `messages`, precisely so a browser cannot claim what was said before —
//     a client that could post its own transcript could invent a prior
//     ASSISTANT turn ("you already quoted me $5") and have the model honour
//     its own fabrication. This file posts the visitor's sentence and the id
//     the server handed back, and nothing else. The transcript below is a
//     rendering, not a record.
//
//   * It does not work out numbers. Every price, date and count comes through
//     `cards`, drawn by AskCards.tsx over the server's own integers. See that
//     file's header.
//
//   * It does not put the model's text through anything that can execute it.
//     The reply is rendered as text nodes; there is no markdown pass and no
//     `dangerouslySetInnerHTML`, because the one string on this page that a
//     stranger can influence is the one the model wrote.
//
// WHY THERE IS NO TOOL-BY-TOOL TYPING INDICATOR. `lib/lead-engine/chat/tools.ts`
// exports `TOOL_LABELS`, and the plan asked for them here — but `POST /api/ask`
// returns `{conversationId, reply, cards, verdict}` and says nothing about
// which tools ran. A widget cycling "Checking the camp and clinic schedule"
// while no such lookup is happening is a fabricated detail, in a feature whose
// entire thesis is that it does not invent details. One honest line instead.
//
// THEME. The public site's tokens flip under `.dark`; only the tokens that
// `.dark` actually redefines are used for colour (`background`, `foreground`,
// `card`, `muted`, `border`, `input`, `primary`). `--surface`, `--success`,
// `--warning` and `--error` are declared on `:root` alone in app/globals.css,
// so anything painted with them stays light-on-light in dark mode.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md
//       §6.1, §6.2

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { SendHorizonal, X } from "lucide-react"

import { AskCard } from "@/components/public/AskCards"
import { MAX_MESSAGE_CHARS, MAX_MESSAGES_PER_CONVERSATION } from "@/lib/lead-engine/chat/constants"
import type { Card } from "@/lib/lead-engine/chat/tools"

type Turn = { id: string; role: "you"; text: string } | { id: string; role: "assistant"; text: string; cards: Card[] }

export type AskPanelProps = {
  /**
   * `business_settings.display_name`, threaded from a server parent — `''` in
   * production and in the dev clone. Passed rather than pre-rendered into a
   * sentence so the card asks `hasChatConsentDisplayName` itself: the exact
   * function `/api/ask/capture` asks before it will file a consent row.
   */
  displayName: string
  /** `page` is /ask; `panel` is the docked/full-screen surface the sticky bar opens. */
  variant?: "page" | "panel"
  onClose?: () => void
}

const OPENING =
  "Ask me anything about the coaching, the camps and clinics, or how to get started. I answer from what's actually published — if I don't know, I'll say so and put you to a person."

/** Shown when the request never got an answer at all. Same register as the route's own copy. */
const UNREACHABLE = "I couldn't reach the assistant just then. Try again in a moment."

const AT_CAP = "We've covered a lot in this conversation. Start a new one and I'll keep going."

/** The turn cannot be streamed — it has to be validated whole — so this stands in for tokens arriving. */
const THINKING = "Looking that up…"

/**
 * THE ONLY THING ON THIS SURFACE THAT SAYS WHAT HAPPENS TO WHAT THE VISITOR
 * TYPES. It is a box on a public page that invites free text from strangers,
 * and people bring it exactly what you would expect: a parent describing a
 * child's knee. Before this line the panel said one thing — "Answers come from
 * what's published on this site" — which is about the ANSWER, not about their
 * message. Nothing said the message is kept, that a person here reads it, or
 * that it is sent to an outside model vendor to be answered.
 *
 * Three rules it is written to:
 *
 *   * PLAIN WORDS. The reader is a parent on a phone, not an engineer. No
 *     "third party", no "data", no "processing", no "retention".
 *   * NO OVERCLAIM. It does not say the privacy policy covers chat, because it
 *     does not: the active legal documents contain no mention of chat,
 *     assistants, transcripts or automated replies. The link is a pointer to
 *     the policy that exists, not a promise about what is in it. If chat is
 *     ever written into that document, THIS is the sentence to revisit.
 *   * NO BUSINESS NAME. This file is inside the Lead Engine's brand sweep, and
 *     the operator's identity is a value (`displayName`), never a literal.
 */
const PRIVACY_NOTICE =
  "What you type here is saved, and a person from the team may read it later. It's also sent to an outside company whose software writes the replies."

let turnSeq = 0
function nextId(): string {
  turnSeq += 1
  return `turn-${turnSeq}`
}

export function AskPanel({ displayName, variant = "page", onClose }: AskPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  /**
   * The DB is the control: `/api/ask` refuses a turn once
   * `chat_conversations.message_count` reaches the cap, and that count is an
   * exact COUNT of `chat_messages` — so one exchange is TWO rows. This mirror
   * exists only so the composer stops offering an action that is going to be
   * refused. It is deliberately allowed to be conservative: a turn the server
   * rejected is rolled back below, so the two stay in step.
   */
  const atCap = turns.length >= MAX_MESSAGES_PER_CONVERSATION

  useEffect(() => {
    // Optional call: jsdom has no `scrollIntoView`, and keeping the newest turn
    // in view is a nicety — never a reason for a render to throw.
    endRef.current?.scrollIntoView?.({ block: "end" })
  }, [turns.length, pending])

  async function send() {
    const message = draft.trim()
    if (!message || pending || atCap) return

    const optimistic: Turn = { id: nextId(), role: "you", text: message }
    setTurns((prev) => [...prev, optimistic])
    setDraft("")
    setNotice(null)
    setPending(true)

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Two fields. Adding a third that describes the past is the one thing
        // this client must never do — see the file header.
        body: JSON.stringify(conversationId ? { conversationId, message } : { message }),
      })
      const body = (await response.json()) as {
        conversationId?: string
        reply?: string
        cards?: Card[]
        error?: string
      }

      if (!response.ok) {
        // The server stored nothing, so neither does the transcript — that
        // keeps the mirror above honest — and the visitor gets their sentence
        // back in the box rather than having to retype it. The message shown
        // is the ROUTE'S OWN copy: a rate limit is a calm sentence about
        // pacing, not an error.
        setTurns((prev) => prev.filter((turn) => turn.id !== optimistic.id))
        setDraft(message)
        setNotice(typeof body.error === "string" && body.error ? body.error : UNREACHABLE)
        return
      }

      if (body.conversationId) setConversationId(body.conversationId)
      setTurns((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", text: body.reply ?? "", cards: body.cards ?? [] },
      ])
    } catch {
      setTurns((prev) => prev.filter((turn) => turn.id !== optimistic.id))
      setDraft(message)
      setNotice(UNREACHABLE)
    } finally {
      setPending(false)
    }
  }

  function startOver() {
    setConversationId(null)
    setTurns([])
    setNotice(null)
    setDraft("")
  }

  const isPanel = variant === "panel"

  return (
    <div
      {...(isPanel ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Ask a question" } : {})}
      className={[
        "flex flex-col overflow-hidden border-border bg-background text-foreground",
        isPanel ? "h-full w-full border shadow-2xl sm:rounded-2xl" : "h-full w-full rounded-2xl border",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="font-heading text-sm font-semibold">Ask a question</p>
          <p className="text-xs text-muted-foreground">Answers come from what&apos;s published on this site.</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{OPENING}</p>

        {turns.map((turn) =>
          turn.role === "you" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                {turn.text}
              </p>
            </div>
          ) : (
            <div key={turn.id} className="space-y-3">
              <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-relaxed">
                {/* Text nodes only. No markdown pass, no innerHTML. */}
                {turn.text
                  .split(/\n{2,}/)
                  .filter((para) => para.trim().length > 0)
                  .map((para, index) => (
                    <p key={index} className="whitespace-pre-wrap">
                      {para}
                    </p>
                  ))}
              </div>
              {turn.cards.map((card, index) => (
                <AskCard
                  key={`${turn.id}-card-${index}`}
                  card={card}
                  conversationId={conversationId}
                  displayName={displayName}
                />
              ))}
            </div>
          ),
        )}

        {pending ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {THINKING}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-border bg-muted px-3.5 py-2 text-sm text-muted-foreground"
          >
            {notice}
          </p>
        ) : null}

        {atCap ? (
          <div className="rounded-xl border border-border bg-muted px-3.5 py-3 text-sm text-muted-foreground">
            <p>{AT_CAP}</p>
            <button
              type="button"
              onClick={startOver}
              className="mt-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start a new conversation
            </button>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <div className="border-t border-border">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
          className="flex items-end gap-2 px-3 pt-3"
        >
          <textarea
            aria-label="Your question"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={1}
            // The same ceiling the route enforces, so a long paste is trimmed
            // where the visitor can see it rather than rejected after the trip.
            maxLength={MAX_MESSAGE_CHARS}
            disabled={atCap}
            placeholder="Ask about coaching, camps or getting started"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={atCap || pending || draft.trim().length === 0}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <SendHorizonal className="size-4" aria-hidden="true" />
            <span className="sr-only">Send</span>
          </button>
        </form>

        {/* Beside the composer, not in the transcript above it: the transcript
            scrolls, and this has to still be there on the tenth turn. */}
        <p className="px-3.5 pb-3 pt-2 text-xs leading-relaxed text-muted-foreground">
          {PRIVACY_NOTICE}{" "}
          <Link
            href="/privacy-policy"
            // A new tab, so reading it does not throw the conversation away.
            target="_blank"
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Read our privacy policy.
          </Link>
        </p>
      </div>
    </div>
  )
}
