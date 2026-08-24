import { Users } from "lucide-react"
import Link from "next/link"
import { listFunnels } from "@/lib/db/funnels"
import {
  countLeads,
  countLeadsByStatus,
  getQuizOutcomesForLeads,
  listLeads,
  type LeadFilters,
} from "@/lib/db/funnel-leads"
import { LeadsBoard } from "@/components/admin/funnels/LeadsBoard"
import type { FunnelLeadStatus } from "@/types/database"

export const metadata = { title: "Leads" }

/** How many rows the page holds before the footer says "showing N of M". */
const PAGE_SIZE = 200

const STATUSES = new Set<FunnelLeadStatus>(["new", "contacted", "signed_up"])

/**
 * The leads a funnel captured.
 *
 * Filters live in the URL rather than in component state so a filtered view is
 * a link — which is what makes the count badge on the funnels board able to
 * point at "the leads for THIS page" without this screen knowing anything about
 * that board.
 */
export default async function FunnelLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const read = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ""
  }

  const funnelId = read("funnelId")
  const statusParam = read("status")
  const days = read("days")
  const search = read("search")

  // Every filter is validated before it reaches the DAL. `status` in particular
  // goes into an `eq` on a CHECK-constrained column, and `days` into date
  // arithmetic — a junk value should narrow to nothing or be ignored, never
  // reach the query as-is.
  const status = STATUSES.has(statusParam as FunnelLeadStatus) ? (statusParam as FunnelLeadStatus) : undefined
  const dayCount = /^\d{1,4}$/.test(days) ? Number(days) : undefined
  const since = dayCount ? new Date(Date.now() - dayCount * 86_400_000).toISOString() : undefined

  const filters: LeadFilters = {
    funnelId: funnelId || undefined,
    status,
    since,
    search: search || undefined,
  }

  const [leads, total, counts, funnels] = await Promise.all([
    listLeads({ ...filters, limit: PAGE_SIZE }),
    countLeads(filters),
    // Counts for the status chips ignore the status filter itself — otherwise
    // selecting "New" would show "New (12)" and zero for the other two, which
    // reads as "there are no contacted leads" rather than "you are not looking
    // at them".
    countLeadsByStatus({ ...filters, status: undefined }),
    listFunnels().catch(() => []),
  ])

  // THE RESULTS BEHIND THE QUIZ LEADS ON THIS PAGE, and only them.
  //
  // Fails soft: a lead whose score cannot be read is still a person to call,
  // and taking the whole inbox down over a missing number would be the wrong
  // trade. A page with no quiz leads on it makes no query at all.
  const attemptIds = leads
    .map((lead) => lead.quiz_attempt_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
  const quizOutcomes = attemptIds.length > 0 ? await getQuizOutcomesForLeads(attemptIds).catch(() => ({})) : {}

  const exportParams = new URLSearchParams()
  for (const [key, value] of Object.entries({ funnelId, status: statusParam, days, search })) {
    if (value) exportParams.set(key, value)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone who filled in a form or finished a quiz on a{" "}
            <Link href="/admin/pages" className="underline underline-offset-2 hover:text-primary">
              landing page
            </Link>
            . They also appear under Contacts — the answers they gave are only here.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Users className="size-5 text-accent" />
        </div>
      </div>

      <LeadsBoard
        leads={leads}
        total={total}
        counts={counts}
        funnels={funnels.map((funnel) => ({ id: funnel.id, name: funnel.name }))}
        filters={{ funnelId, status: statusParam, days, search }}
        exportHref={`/api/admin/funnels/leads/export?${exportParams.toString()}`}
        quizOutcomes={quizOutcomes}
      />
    </div>
  )
}
