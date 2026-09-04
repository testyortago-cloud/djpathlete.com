// app/(admin)/admin/chat/page.tsx — every conversation the public assistant
// has had, and the three outcomes worth an operator's attention.
//
// FILTERS LIVE IN THE URL, not in component state, the same way
// app/(admin)/admin/contacts/page.tsx and app/(admin)/admin/funnels/leads
// do it: a filtered view is a link, so "the conversations where a reply was
// blocked" is something a person can bookmark, share, and come back to.
//
// THE READS ARE NOT WRAPPED IN try/catch, and that is the point rather than an
// omission. A failed read must not render as an empty conversation list —
// those two need to look different, or a broken query reads as "nobody has
// ever used the assistant" and someone concludes the widget is not live.
// Letting it propagate reaches app/(admin)/admin/error.tsx, which is visibly
// not a table with no rows in it. Same reasoning as
// app/(admin)/admin/contacts/page.tsx and app/(admin)/admin/pipeline/page.tsx.

import { MessagesSquare } from "lucide-react"
import { requirePermission } from "@/lib/permissions/guard"
import { countChatConversations, listChatConversations, parseChatFilters } from "@/lib/db/chat"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { ChatTable } from "@/components/admin/chat/ChatTable"

export const metadata = { title: "Chat assistant" }
export const dynamic = "force-dynamic"

/**
 * How many rows one page holds.
 *
 * Smaller than the contacts list's 100 on purpose: every row here costs a
 * second lookup's worth of blocked-reply counting, and `blockedCountsFor`
 * (lib/db/chat.ts) chunks its query on the arithmetic that a conversation can
 * hold at most `MAX_MESSAGES_PER_CONVERSATION` messages. 25 keeps that read
 * inside one round trip.
 */
const PAGE_SIZE = 25

export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermission("contacts")

  // Not wrapped in try/catch: NoAccessibleBusinessError is caught by the
  // admin layout, which redirects — the established convention for an admin
  // PAGE (contrast a route handler, which must answer its own 403).
  const { businessId } = await resolveAdminTenant()

  const params = await searchParams
  const read = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ""
  }

  // EVERY searchParam is validated before it reaches the DAL — `show` against
  // a fixed set, `page` against a digit pattern. `parseChatFilters` owns both
  // (lib/db/chat.ts) so the rejection is unit-testable without rendering this
  // component, and so a hand-edited `?page=` cannot become a negative
  // `.range()` start that PostgREST answers with a 400.
  const filters = parseChatFilters({ show: read("show"), page: read("page") })

  const [conversations, total] = await Promise.all([
    // The page number is turned into an offset HERE and not in the DAL,
    // because this is the only file that knows the page size.
    listChatConversations({
      businessId,
      show: filters.show,
      limit: PAGE_SIZE,
      offset: (filters.page - 1) * PAGE_SIZE,
    }),
    countChatConversations({ businessId, show: filters.show }),
  ])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Chat assistant</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The questions visitors have asked the assistant on the website, and what it said back. A conversation marked{" "}
            <strong className="font-medium text-foreground">blocked</strong> is one where a reply was stopped before the
            visitor saw it — open it to see what it tried to say and why it was not allowed to.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <MessagesSquare className="size-5 text-accent" />
        </div>
      </div>

      <ChatTable
        conversations={conversations}
        total={total}
        page={filters.page}
        pageSize={PAGE_SIZE}
        // The FILTER only. `page` is passed separately and on purpose: the
        // table rebuilds the query string from this object whenever the filter
        // changes, so a page number that survived a narrowing filter would
        // leave the operator on page 2 of a one-page result.
        filters={{ show: filters.show }}
      />
    </div>
  )
}
