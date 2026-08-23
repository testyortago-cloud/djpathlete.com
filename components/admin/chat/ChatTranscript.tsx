// components/admin/chat/ChatTranscript.tsx — one conversation, turn by turn,
// and the evidence behind every verdict.
//
// ---------------------------------------------------------------------------
// A BLOCKED TURN SHOWS BOTH HALVES OR IT SHOWS NOTHING USEFUL.
// ---------------------------------------------------------------------------
// `chat_messages.fact_set` is persisted per message on purpose (spec §3): the
// claim this whole feature rests on is "the model said $120 and nothing in the
// fact set contained 120", and that is only CHECKABLE afterwards if both the
// violation and the fact set it was checked against are on the screen
// together. Showing the violation alone reduces the page to "the computer said
// no"; showing the fact set alone says nothing about what went wrong.
//
// The blocked turn also shows THE WORDS THE MODEL WROTE, not the refusal the
// visitor read. The visitor's side of that turn is a fixed sentence, and it is
// the same fixed sentence every time; the useful artifact is the reply that
// never left the building.
//
// No client JS: the fold on a clean turn is a plain `<details>`, so nothing
// here needs to be a client component.
//
// Light-only, like the rest of the admin.

import { DataTableBadge, type DataTableBadgeTone } from "@/components/ui/data-table"
// Reused rather than re-declared — a pure cents → "$1,234.56" formatter. Money
// is formatted from the server's INTEGER CENTS here, never re-parsed out of
// prose, which is the same rule the public cards follow.
import { formatCents } from "@/lib/bookkeeping/money"
// `ChatMessage` IS A NAME COLLISION — `lib/validators/ai-chat.ts` exports a
// different one (the admin program-builder transcript shape). The row type is
// imported explicitly from the database types and aliased, so nothing in this
// file can pick up the wrong one by autocomplete.
import type { ChatMessage as ChatMessageRow } from "@/types/database"

export interface ChatTranscriptProps {
  messages: ChatMessageRow[]
}

export function ChatTranscript({ messages }: ChatTranscriptProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-white p-12 text-center text-muted-foreground shadow-sm">
        This conversation has no messages in it. Someone opened the assistant and never asked anything.
      </div>
    )
  }

  return (
    <ol className="space-y-4">
      {messages.map((message) => (
        <li key={message.id}>
          <Turn message={message} />
        </li>
      ))}
    </ol>
  )
}

function Turn({ message }: { message: ChatMessageRow }) {
  const isVisitor = message.role === "user"
  const verdict = verdictBadge(message)
  const blocked = message.verdict === "blocked"
  const facts = factsOf(message.fact_set)
  const grounded = groundedValuesOf(message.fact_set)
  const risk = riskOf(message.fact_set)

  return (
    <article
      data-slot="chat-turn"
      data-message={message.id}
      data-verdict={message.verdict ?? "none"}
      className={`rounded-xl border p-4 shadow-sm ${
        blocked ? "border-destructive/30 bg-destructive/5" : "border-border bg-white"
      }`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{isVisitor ? "Visitor" : "Assistant"}</span>
        <time className="text-xs text-muted-foreground" dateTime={message.created_at}>
          {formatMoment(message.created_at)}
        </time>
        {/* A visitor's message carries no verdict, because nothing checked it. */}
        {verdict ? <DataTableBadge tone={verdict.tone}>{verdict.label}</DataTableBadge> : null}
        {message.model ? <span className="text-xs text-muted-foreground">{message.model}</span> : null}
        {message.tokens_input != null || message.tokens_output != null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {(message.tokens_input ?? 0).toLocaleString()} in · {(message.tokens_output ?? 0).toLocaleString()} out
          </span>
        ) : null}
      </header>

      {blocked ? (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-destructive">
          What it tried to say — the visitor never saw this
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-sm text-foreground">{message.content}</p>

      {message.verdict === "short_circuit" ? (
        <p data-testid="short-circuit-note" className="mt-3 rounded-lg bg-surface/60 p-3 text-sm text-muted-foreground">
          The model was never called. The question was classified as {risk ?? "a risk"} and answered with a fixed
          refusal before any generation happened.
        </p>
      ) : null}

      {blocked ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-white p-3">
          <p className="text-sm font-medium text-destructive">Why this reply was blocked</p>
          <ul data-testid="violations" className="mt-1 space-y-1 text-sm text-foreground">
            {violationsOf(message.violations).map((violation, index) => (
              <li key={`${violation.rule}-${index}`}>
                <span className="font-mono text-xs">{violation.rule}</span>
                {violation.found ? <> — {violation.found}</> : null}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm font-medium text-foreground">What it was checked against</p>
          <FactSet facts={facts} grounded={grounded} />
        </div>
      ) : facts.length > 0 || grounded.length > 0 ? (
        // Kept, but folded away. On a clean turn the fact set is background;
        // on a blocked one it is the evidence, which is why the blocked branch
        // above opens it rather than hiding it behind a click.
        <details className="mt-3 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            What this reply was checked against
          </summary>
          <FactSet facts={facts} grounded={grounded} />
        </details>
      ) : null}
    </article>
  )
}

function FactSet({ facts, grounded }: { facts: Array<Record<string, unknown>>; grounded: string[] }) {
  return (
    <div className="mt-2 space-y-2">
      {facts.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {facts.map((fact, index) => (
            <li key={index}>{describeFact(fact)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No lookups were made on this turn.</p>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Values a reply was allowed to contain
        </p>
        {/* Every form of every number the lookups returned. A number in the
            reply that is not in this list is what "ungrounded" means, and this
            is the list an operator checks it against. */}
        <p data-testid="grounded-values" className="mt-1 break-words font-mono text-xs text-muted-foreground">
          {grounded.length > 0 ? grounded.join(" · ") : "none"}
        </p>
      </div>
    </div>
  )
}

/**
 * The stored verdict, as a pill.
 *
 * `null` on an assistant turn is its own answer and gets its own pill — a row
 * written before the verdict column meant anything, or by a path that did not
 * set it. Rendering nothing there would make it indistinguishable from a
 * visitor's message.
 */
function verdictBadge(message: ChatMessageRow): { label: string; tone: DataTableBadgeTone } | null {
  if (message.role !== "assistant") return null
  switch (message.verdict) {
    case "ok":
      return { label: "Answered", tone: "success" }
    case "blocked":
      return { label: "Blocked", tone: "danger" }
    case "short_circuit":
      return { label: "Fixed refusal", tone: "warning" }
    default:
      return { label: "No verdict", tone: "neutral" }
  }
}

/**
 * `violations` is `unknown[]` on the row, and deliberately so: the route
 * persists its own round-limit and empty-reply notes alongside the validator's
 * real `Violation` values rather than widening that union. So this reads
 * `rule` / `found` off whatever is there and falls back to the raw JSON, which
 * is the contract app/api/ask/route.ts states in as many words.
 */
function violationsOf(raw: unknown[]): Array<{ rule: string; found: string }> {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>
      const rule = typeof record.rule === "string" ? record.rule : null
      if (rule) return { rule, found: typeof record.found === "string" ? record.found : "" }
    }
    return { rule: "unrecognised", found: JSON.stringify(entry) }
  })
}

function factsOf(factSet: Record<string, unknown>): Array<Record<string, unknown>> {
  const facts = factSet?.facts
  if (!Array.isArray(facts)) return []
  return facts.filter((fact): fact is Record<string, unknown> => !!fact && typeof fact === "object")
}

function groundedValuesOf(factSet: Record<string, unknown>): string[] {
  const values = factSet?.groundedValues
  if (!Array.isArray(values)) return []
  return values.filter((value): value is string => typeof value === "string")
}

/** Set only on a short-circuited turn, where the fact set holds the classification. */
function riskOf(factSet: Record<string, unknown>): string | null {
  const risk = factSet?.risk
  return typeof risk === "string" ? risk : null
}

/**
 * One line per fact, in the shape the lookup returned it.
 *
 * The fallback is the raw JSON rather than a friendly "1 fact": a fact set
 * nobody can read is a fact set that cannot be checked, and this page exists
 * to be checked against.
 */
function describeFact(fact: Record<string, unknown>): string {
  const text = (value: unknown): string => (typeof value === "string" ? value : "")
  const money = (value: unknown): string => (typeof value === "number" ? formatCents(value) : "no price")
  const count = (value: unknown): string => (typeof value === "number" ? String(value) : "?")

  switch (fact.kind) {
    case "faq":
      return `FAQ — “${text(fact.question)}” → ${text(fact.answer)}`
    case "programme":
      return `Programme — ${text(fact.name)} · ${money(fact.priceCents)} · ${count(fact.durationWeeks)} weeks · ${count(
        fact.sessionsPerWeek,
      )} sessions a week`
    case "event":
      return `Event — ${text(fact.title)} · ${text(fact.startDate).slice(0, 10)} · ${text(fact.locationName)} · ${money(
        fact.priceCents,
      )} · ${count(fact.spotsLeft)} spots left`
    case "testimonial":
      return `Testimonial — “${text(fact.quote)}” — ${text(fact.author)}`
    default:
      return JSON.stringify(fact)
  }
}

function formatMoment(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "—"
  return then.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}
