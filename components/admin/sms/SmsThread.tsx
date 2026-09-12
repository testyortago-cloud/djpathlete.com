// components/admin/sms/SmsThread.tsx — one conversation, as bubbles.
//
// DELIBERATELY NOT A DataTable. The house rule is that every LIST is a
// DataTable, and this is not a list — it is a conversation, and it has to
// read like the one on the coach's own phone: newest at the BOTTOM, their
// words on the left, ours on the right, and each of ours carrying its own
// delivery state.
//
// EVERY OUTBOUND MESSAGE SHOWS ITS STATUS, and that is the point of the
// screen rather than decoration. A text that Twilio accepted and then failed
// to deliver looks exactly like a text that landed, unless something says so
// — and "I texted them and they never replied" is a completely different
// conversation from "the message never arrived". The status word is the
// carrier's own (see `updateSmsStatusBySid`), not translated into our
// vocabulary, so an unfamiliar word is a real carrier word and can be looked
// up rather than a mapping bug.
//
// Light-only, like the rest of the admin.

import { Bot, TriangleAlert } from "lucide-react"
import type { SmsMessageRow } from "@/lib/db/sms-messages"

export interface SmsThreadProps {
  messages: SmsMessageRow[]
  /** The tenant's timezone, so the times read in the coach's own clock. */
  timezone: string
}

/** Which statuses mean "this did not reach them". */
const FAILED_STATUSES = new Set(["failed", "undelivered"])

function formatWhen(iso: string, timezone: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at)
}

export function SmsThread({ messages, timezone }: SmsThreadProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-white p-12 text-center text-sm text-muted-foreground shadow-sm">
        No texts with this number yet. Send the first one below.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
      {messages.map((message) => {
        const outbound = message.direction === "outbound"
        const failed = outbound && FAILED_STATUSES.has(message.status)
        return (
          <div key={message.id} className={outbound ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[80%]">
              <div
                className={
                  outbound
                    ? "rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
                    : "rounded-2xl rounded-bl-sm bg-surface px-4 py-2 text-sm text-foreground"
                }
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
              <div
                className={
                  outbound
                    ? "mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground"
                    : "mt-1 flex items-center gap-2 text-xs text-muted-foreground"
                }
              >
                <time dateTime={message.occurred_at}>{formatWhen(message.occurred_at, timezone)}</time>
                {outbound ? (
                  <span className={failed ? "font-medium text-destructive" : undefined}>
                    {failed ? <TriangleAlert aria-hidden className="mr-1 inline size-3" /> : null}
                    {message.status}
                    {message.error_code ? ` (${message.error_code})` : ""}
                  </span>
                ) : null}
                {/* A text the sequence engine sent, not a person. Worth
                    marking: "why did they get this at 9am" has a different
                    answer for each. */}
                {message.sequence_message_id ? (
                  <span className="inline-flex items-center gap-1">
                    <Bot aria-hidden className="size-3" />
                    Automatic
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
