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
import { currentActor, requirePermission } from "@/lib/permissions/guard"
import { canAccessPath } from "@/lib/permissions/registry"
import { countContacts, listContacts, parseContactFilters } from "@/lib/db/contacts-list"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listSequences } from "@/lib/db/sequences"
import { tagsForContacts } from "@/lib/db/contact-tags"
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

/**
 * May THIS viewer use the "add to a sequence" action?
 *
 * Asked of the same registry that gates the route the button posts to, rather
 * than hardcoded to `role === "admin"`, so the two cannot drift: if
 * /api/admin/sequences/enrol is ever mapped and its own role check relaxed
 * (the follow-up its :117-131 comment describes), the button appears on its
 * own with no change here.
 */
async function viewerCanEnrol(): Promise<boolean> {
  const actor = await currentActor()
  return canAccessPath(actor, "/api/admin/sequences/enrol", "POST")
}

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()
  const canEnrol = await viewerCanEnrol()
  const canSeeLeads = canAccessPath(await currentActor(), "/admin/funnels/leads", "GET")

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
  // rather than throwing on an Invalid Date. It deliberately does not set
  // `businessId` — that comes from the resolved tenant, not the URL bar.
  const filters = parseContactFilters(raw)

  const [contacts, total, sequences] = await Promise.all([
    // The page number is turned into an offset HERE and not in the DAL, because
    // this is the only file that knows the page size — see PAGE_SIZE above.
    listContacts({ ...filters, businessId, limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE }),
    countContacts({ ...filters, businessId }),
    // Both DAL functions default to SINGLETON_BUSINESS_ID when omitted, which
    // is exactly the bug here: leaving businessId off would offer the
    // OPERATOR's sequences to another business's coach, who could then enrol
    // this business's own contacts into one of them -- a cross-tenant WRITE,
    // not a display bug. The default stays for the other callers that still
    // rely on it; this call site must always pass the real value.
    listSequences(businessId),
  ])

  // ONE round trip for every row's tags, not one per row. Read AFTER the list
  // because it is keyed on the ids that came back — and a Map cannot cross the
  // server/client boundary, so it is handed over as a plain object.
  const tagMap = await tagsForContacts(
    contacts.map((contact) => contact.id),
    businessId,
  )
  const tagsByContact = Object.fromEntries(tagMap)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone this business has a name, an email address or a phone number for — from{" "}
            {/* A LINK ONLY FOR SOMEONE WHO CAN OPEN IT. /admin/funnels/leads needs
                the `funnels` permission, so for a coach holding only `contacts`
                this was a dead link in the first paragraph of their own home
                page. Plain text says the same thing and goes nowhere. */}
            {canSeeLeads ? (
              <Link href="/admin/funnels/leads" className="underline underline-offset-2 hover:text-primary">
                landing page forms
              </Link>
            ) : (
              "landing page forms"
            )}{" "}
            and from the contacts imported from the old system.
            {canEnrol ? " Tick the ones you want and add them to a sequence." : ""}
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <UsersRound className="size-5 text-accent" />
        </div>
      </div>

      <ContactsTable
        canEnrol={canEnrol}
        contacts={contacts}
        tagsByContact={tagsByContact}
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
