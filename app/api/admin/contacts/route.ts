// app/api/admin/contacts/route.ts — GET ?search=<term>&limit=<n>. The search
// behind the "add someone to this board" dialog, and the first HTTP surface
// this repo has ever had over the contact spine as a LIST.
//
// WHY IT EXISTS (G29 Task 8, R14). The dialog is a client component; the only
// search capability in the repo is `listContacts` + `contactSearchClause` in
// lib/db/contacts-list.ts, which is server-only DAL. The alternative — handing
// the whole contact list to the browser as a prop and filtering it there — is
// both a payload problem (`PAGE` is 1000) and a disclosure one: a coach would
// have every contact's email and phone in the page source whether they searched
// for them or not.
//
// A THIN WRAPPER, BY CONSTRUCTION. No query is written here. `listContacts`
// already applies the tenant predicate, already strips PostgREST's own
// separators out of the search term, and already caps the term's length.
//
// NOT AUDITED, DELIBERATELY. `/admin/contacts` — the full list page, with the
// same columns and no cap at 20 — records nothing either; only
// `/admin/contacts/[id]` writes `contact.viewed`, because opening ONE person's
// record is the act worth keeping. A debounced typeahead would write a row per
// keystroke into a table that already has a retention cron precisely because
// its growth is a real cost.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { listContacts } from "@/lib/db/contacts-list"

export const dynamic = "force-dynamic"

/**
 * The most rows a typeahead ever wants, and the cap a caller cannot argue with.
 *
 * `listContacts` clamps to `PAGE` (1000), but that is the size of a LIST PAGE,
 * not of a dropdown — passing a caller's `?limit=100000` straight through would
 * put a thousand contacts into a menu nobody can read and a response nobody
 * asked for. The cap is applied here, on the way in, so it binds regardless of
 * what the DAL's own clamp happens to be.
 */
const MAX_RESULTS = 20

/**
 * Reads `?limit=`, falling back to the cap for anything that is not a whole
 * number of rows. `Number("")` is 0 and `Number("abc")` is NaN; neither is a
 * page size, and both used to mean "0 rows" if passed through unchecked.
 */
function resolveLimit(raw: string | null): number {
  const asked = Number(raw)
  if (!Number.isInteger(asked) || asked < 1) return MAX_RESULTS
  return Math.min(asked, MAX_RESULTS)
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // `/api/admin/contacts` is mapped to the staff-grantable `contacts`
  // permission (lib/permissions/registry.ts), so a coach reaches this. Being
  // on a gated PREFIX is not the same as running the check, which is why the
  // call is here and not assumed.
  if (!(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  const params = new URL(request.url).searchParams
  const search = (params.get("search") ?? "").trim()

  // A BLANK TERM IS NOT "EVERYBODY". `contactSearchClause` returns null for a
  // blank term, and a null clause means `listContacts` applies NO search
  // predicate at all — every contact this tenant has, newest first. That is the
  // right answer for the contacts list page, which is asking for exactly that,
  // and the wrong answer for a search box nobody has typed in yet. Answered
  // here rather than by passing it down, so the read never happens.
  if (search.length === 0) {
    return NextResponse.json({ contacts: [] })
  }

  try {
    // `businessId` comes from `resolveAdminTenantForRequest`, NEVER from the
    // query string — `ContactFilters.businessId` is required rather than
    // defaulted for this exact reason, and a `?businessId=` in the URL reaches
    // nothing.
    const contacts = await listContacts({
      businessId,
      search,
      limit: resolveLimit(params.get("limit")),
    })
    return NextResponse.json({ contacts })
  } catch (err) {
    // `listContacts` throws `listContacts: <PostgREST's own message>`, which
    // names columns and constraints. That belongs in the server log, not in a
    // browser — and a coach can do nothing with it either way.
    console.error("[api/admin/contacts] search failed", err)
    return NextResponse.json({ error: "Could not search your contacts right now." }, { status: 500 })
  }
}
