// app/(admin)/admin/chat/[id]/page.tsx — one conversation, read in full.
//
// OPENING THIS PAGE IS AN AUDITED EVENT. `chat.transcript_viewed` is the one
// slug in this branch that belongs to a READ rather than a write, and its
// category is `admin_read_sensitive` rather than `admin_read` for a specific
// reason: a transcript is visitor-typed prose. Nobody controls what somebody
// types into a public chat box, and people type their own name, their child's
// name, their injury and their phone number into one without being asked. So
// who read it is worth keeping, in the same way a client's medical note is.
//
// It is recorded AFTER the conversation is known to exist. A 404 is not a
// sensitive read, and auditing one would put rows in `audit_logs` for
// transcripts nobody ever saw.
//
// THE READS ARE NOT WRAPPED IN try/catch — see app/(admin)/admin/chat/page.tsx
// for the reasoning. A failed read reaches app/(admin)/admin/error.tsx rather
// than rendering as a conversation with nothing in it.
//
// THE IP HASH DOES NOT REACH THIS PAGE. `chat_conversations` stores
// sha256(ip + salt) and never the address (migration 00227); the hash is a
// join key for the rate limiter, not something an operator has any use for.

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { getConversation, listMessages } from "@/lib/db/chat"
import { recordAudit } from "@/lib/audit/record"
import { ChatTranscript } from "@/components/admin/chat/ChatTranscript"
import { DataTableBadge } from "@/components/ui/data-table"

export const metadata = { title: "Chat transcript" }
export const dynamic = "force-dynamic"

export default async function AdminChatTranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("contacts")
  // SCOPED BY BUSINESS. `id` comes straight from the URL bar, and until
  // 2026-09-04 it was passed to an unscoped `getConversation` — safe only
  // while `/admin/chat` was unmapped in PATH_PERMISSIONS and the proxy
  // default-denied every staff member. This page is now reachable by any coach
  // holding `contacts`, so the read must be fenced to the tenant they resolved
  // to; otherwise a guessed UUID reads another coach's visitor conversations,
  // which is exactly the prose this file's header explains is sensitive.
  const { businessId } = await resolveAdminTenant()

  const { id } = await params

  // `getConversation` returns null only when the row is not there — a failed
  // READ throws (lib/db/chat.ts). So this branch really is "no such
  // conversation" and nothing else. It ALSO means "this conversation belongs
  // to a different business", since the read is scoped to businessId — a 404
  // is the right answer for both, and the right one to fail closed to. Same
  // rule app/(admin)/admin/contacts/[id]/page.tsx states.
  const conversation = await getConversation(id, businessId)
  if (!conversation) notFound()

  // Keyed on a conversation this caller has just been PROVEN to own, so it
  // needs no business predicate of its own: an id that survived the read above
  // is in their tenant by construction.
  const messages = await listMessages(id)
  const blockedTurns = messages.filter((message) => message.verdict === "blocked").length

  await recordAudit({
    action: "chat.transcript_viewed",
    category: "admin_read_sensitive",
    target: {
      type: "chat_conversation",
      id: conversation.id,
      // The timestamp, not anything the visitor typed: the audit row is a
      // record of WHO READ WHAT, and putting the visitor's words in it would
      // copy the sensitive content into a second, longer-lived table.
      label: `Conversation started ${conversation.created_at}`,
    },
    metadata: {
      message_count: messages.length,
      blocked_turns: blockedTurns,
      escalated: conversation.escalated_at !== null,
      captured: conversation.captured_at !== null,
    },
  })

  return (
    <div>
      <Link
        href="/admin/chat"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to all conversations
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">Conversation</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            Started <time dateTime={conversation.created_at}>{formatMoment(conversation.created_at)}</time>
          </span>
          <span aria-hidden>·</span>
          <span>
            {messages.length === 1 ? "1 message" : `${messages.length} messages`} on{" "}
            <span className="text-foreground">{conversation.landing_path || "an unknown page"}</span>
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{conversation.tokens_used.toLocaleString()} tokens</span>
        </p>

        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          {conversation.escalated_at ? <DataTableBadge tone="warning">Escalated</DataTableBadge> : null}
          {conversation.captured_at ? <DataTableBadge tone="success">Captured</DataTableBadge> : null}
          {blockedTurns > 0 ? (
            <DataTableBadge tone="danger">
              {blockedTurns === 1 ? "1 reply blocked" : `${blockedTurns} replies blocked`}
            </DataTableBadge>
          ) : null}
        </p>
      </div>

      <ChatTranscript messages={messages} />
    </div>
  )
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
  })
}
