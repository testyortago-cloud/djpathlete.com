// app/(admin)/admin/contacts/page.tsx — everyone in the contact spine, and the
// one action that has been missing since the Lead Engine shipped: putting some
// of them into a sequence by hand.
//
// `cold_lead_re_engagement` was seeded by migration 00218 with
// `trigger_source = NULL` — manual enrolment only — and that migration's own
// table records the consequence in as many words: "No — no manual-enrol
// surface exists yet". `enrolContactManually` (lib/lead-engine/enroll.ts) was
// written for it and had exactly one caller in the repo, a script. This page,
// and app/api/admin/sequences/enrol/route.ts behind it, is the surface.
//
// FILTERS LIVE IN THE URL, not in component state, the same way
// app/(admin)/admin/funnels/leads/page.tsx does it: a filtered view is a link,
// so "the contacts with an email address, added in the last 30 days" is
// something a person can bookmark, share, and come back to after enrolling
// half of them.
//
// The reads are NOT wrapped in try/catch. A failed read must not render as an
// empty contact list — those two need to look different, or a broken query
// reads as "there is nobody in here" and someone concludes the import failed.
// Letting it propagate reaches app/(admin)/admin/error.tsx, which is visibly
// not a table with no rows in it. Same reasoning as
// app/(admin)/admin/pipeline/page.tsx.

import { UsersRound } from "lucide-react"
import Link from "next/link"
import { requireAdmin } from "@/lib/auth-helpers"
import { countContacts, listContacts, parseContactFilters } from "@/lib/db/contacts-list"
import { listSequences } from "@/lib/db/sequences"
import { ContactsTable } from "@/components/admin/contacts/ContactsTable"

export const metadata = { title: "Contacts" }
export const dynamic = "force-dynamic"

/**
 * How many rows one page holds.
 *
 * The same number as `MAX_ENROL_BATCH` (lib/lead-engine/manual-enrol.ts), and
 * not by coincidence: it means "tick the select-all box and enrol everyone on
 * this page" is exactly the biggest batch the API will accept, so the operator
 * can never assemble a selection that gets refused.
 *
 * WHICH MAKES THE PAGER PART OF THE FEATURE, not decoration. Until it existed
 * this page passed `limit` and never an `offset`, so the hundred newest
 * contacts were the only hundred that could ever be ticked — and production
 * already holds 166 imported ones. Neither filter reached the rest: `days`
 * only sets a `gte` lower bound, so it cannot select OLDER rows, and all 166
 * imports share a single `created_at`, so no day count splits them either.
 * (Search did reach any individually-named contact, because `applyFilters`
 * runs before `.range(...)` — the window has always been over the filtered
 * set, not over the table.)
 */
const PAGE_SIZE = 100

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const params = await searchParams
  const read = (key: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? ""
  }

  const raw = { search: read("search"), has: read("has"), days: read("days"), page: read("page") }

  // EVERY searchParam is validated before it reaches the DAL — `has` against a
  // fixed set, `days` and `page` against digit patterns. `parseContactFilters`
  // owns all three (lib/db/contacts-list.ts) so the rejection is unit-testable
  // without rendering this component, and so a junk `?days=` narrows to nothing
  // rather than throwing on an Invalid Date.
  const filters = parseContactFilters(raw)

  const [contacts, total, sequences] = await Promise.all([
    // The page number is turned into an offset HERE and not in the DAL, because
    // this is the only file that knows the page size — see PAGE_SIZE above.
    listContacts({ ...filters, limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE }),
    countContacts(filters),
    listSequences(),
  ])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone this business has a name, an email address or a phone number for — from{" "}
            <Link href="/admin/funnels/leads" className="underline underline-offset-2 hover:text-primary">
              landing page forms
            </Link>{" "}
            and from the contacts imported from the old system. Tick the ones you want and add them to a sequence.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <UsersRound className="size-5 text-accent" />
        </div>
      </div>

      <ContactsTable
        contacts={contacts}
        total={total}
        page={filters.page}
        pageSize={PAGE_SIZE}
        sequences={sequences}
        // The FILTERS only. `page` is passed separately and on purpose: the
        // table rebuilds the query string from this object whenever a filter
        // changes, so anything in here survives that change. A page number that
        // survived a narrowing search would leave the operator on page 2 of a
        // one-page result, looking at an empty table.
        filters={{ search: raw.search, has: raw.has, days: raw.days }}
      />
    </div>
  )
}
