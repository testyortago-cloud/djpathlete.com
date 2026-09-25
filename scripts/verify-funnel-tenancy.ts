// scripts/verify-funnel-tenancy.ts — Task 10 (G31 funnel tenancy) proof.
//
//   source ~/.nvm/nvm.sh && nvm use 24
//   npm run dev                                    # in another terminal (port 3050)
//   npx tsx scripts/verify-funnel-tenancy.ts
//
// WHY THIS SCRIPT EXISTS. Tasks 1-9 converted seven tables and 47 DAL
// functions to carry a tenant, and every one of them is covered by a unit
// test — but production has exactly ONE business, and every unit test
// supplies its own fixtures. Nothing so far has proved isolation against a
// REAL second tenant, driven through the REAL routes, on the REAL dev
// database. This script is that proof, and it is written to be re-run: it
// creates its own fixtures, drives the app over real HTTP, and cleans up
// after itself, verifying the cleanup by reading the rows back.
//
// DEV CLONE ONLY. Refuses to run against anything but `anjvztjiokcgiyhobknq`
// and explicitly refuses production (`epzuvzkokzqtzomeyoha`) even if some
// other env file were pointed at it.
//
// EVERYTHING THIS SCRIPT CREATES IS NAMED "G31 Tenancy Proof" (or a
// `g31-proof-*` slug/host) so a stranger reading the dev clone can tell at a
// glance that a row is this script's fixture and not another session's data.
// The dev clone already carries several other sessions' tenancy fixtures
// (e.g. "Northcrest Barbell *", "Trailhead Strength & Conditioning",
// "phase4-coach.test") — this script never reads, writes or deletes any of
// those; it only ever touches rows it created in this run (tracked by id,
// not by a name pattern).
//
// THE PLATFORM BUSINESS ID IS NEVER A LITERAL. It is resolved via
// `platformBusinessId()`, exactly as the plan's ledger requires (a literal
// would add a `SINGLETON_BUSINESS_ID` reference and move CLAUDE.md's own
// progress bar backwards).
//
// `fetch()` CANNOT override the Host header — verified empirically before
// writing this script (Node's fetch silently keeps the connection's own
// Host). The public `/go` checks below use `node:http` directly instead,
// which honours a caller-supplied Host header, exactly the way a real
// reverse proxy would forward one.
//
// ADMIN AUTHENTICATION uses the dev-only `/api/dev/login` bypass (triple
// gated: non-production, non-Vercel, `DEV_AUTH_BYPASS_ENABLED=true` in
// `.env.local`) to sign in as the seeded admin (`admin@darrenjpaul.com`,
// role `admin`). An `admin` role is an implicit OPERATOR of every business
// (`lib/tenancy/resolve.ts`'s `allowedSet`), so the same session can act as
// either tenant by sending a different `djp_business` cookie — the same
// mechanism the real business switcher uses. This is not a workaround for
// weaker auth; it is driving the same tenant-selection path a real operator
// uses in the browser.

import { readFileSync } from "node:fs"
import http from "node:http"

const CLONE_REF = "anjvztjiokcgiyhobknq"
const PROD_REF = "epzuvzkokzqtzomeyoha"
const APP_HOST = "127.0.0.1"
const APP_PORT = 3050
const APP = `http://${APP_HOST}:${APP_PORT}`
const STAMP = process.env.STAMP ?? String(Date.now()).slice(-8)

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

type CheckResult = { label: string; ok: boolean; detail: string }
const results: CheckResult[] = []

function record(label: string, ok: boolean, detail: string): void {
  results.push({ label, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}\n       ${detail}`)
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(`setup step failed: ${message}`)
  console.log(`  ok — ${message}`)
}

/**
 * A GET with an explicit Host header, via node:http rather than fetch().
 * fetch() silently ignores a caller-supplied Host header (confirmed against a
 * throwaway local server before this script was written: the server always
 * saw its own connection host, never the override) because the Fetch spec
 * treats Host as a forbidden request header. node:http has no such
 * restriction, which is exactly what a Host-based tenancy boundary needs to
 * be tested from outside the browser sandbox.
 */
function rawGet(opts: { host: string; path: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: APP_HOST,
        port: APP_PORT,
        path: opts.path,
        method: "GET",
        headers: { Host: opts.host },
      },
      (res) => {
        let body = ""
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8")
        })
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on("error", reject)
    req.end()
  })
}

interface OffersResponse {
  offers?: { id: string }[]
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Step 0 — environment guard. Set the two env vars the DAL's
  // createServiceRoleClient() reads, from .env.local, and refuse anything
  // but the dev clone.
  // ---------------------------------------------------------------------
  const env = loadEnv(".env.local")
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  must(supabaseUrl.includes(CLONE_REF), `NEXT_PUBLIC_SUPABASE_URL points at the dev clone (${CLONE_REF})`)
  must(!supabaseUrl.includes(PROD_REF), `NEXT_PUBLIC_SUPABASE_URL does not point at production (${PROD_REF})`)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  must(serviceRoleKey.length > 0, "SUPABASE_SERVICE_ROLE_KEY present in .env.local")
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey

  // Imported AFTER the env guard sets the vars these modules' service-role
  // client reads lazily at call time — never a raw insert for anything the
  // real DAL already writes.
  const { createBusiness } = await import("@/lib/db/businesses")
  const { createFunnel, updateFunnel, publishStep, createSubmission } = await import("@/lib/db/funnels")
  const { createEvent } = await import("@/lib/db/events")
  const { platformBusinessId } = await import("@/lib/tenancy/platform")
  const { createServiceRoleClient } = await import("@/lib/supabase")

  const supabase = createServiceRoleClient()
  const platformId = platformBusinessId()
  console.log(`\nplatform business id (via platformBusinessId(), not a literal): ${platformId}\n`)

  let businessBId = ""
  const createdFunnelIds: string[] = []
  let createdEventId = ""
  let createdDomainId = ""

  try {
    // ---------------------------------------------------------------------
    // Step 1 — a second business, via createBusiness(), not a raw insert.
    // ---------------------------------------------------------------------
    const business = await createBusiness({
      name: `G31 Tenancy Proof (${STAMP})`,
      slug: `g31-tenancy-proof-${STAMP}`,
      timezone: "America/New_York",
      hostDisplayName: "G31 Proof Host",
      hostEmail: "g31-proof@example.test",
      createdBy: null,
    })
    businessBId = business.id
    record("create tenant B via createBusiness()", true, `businesses.id=${business.id}, slug=${business.slug}`)

    // create_business() (migration 00244) is one transaction that writes
    // businesses + business_settings + booking_hosts + an owner membership.
    // Verify the atomic write actually happened rather than trusting the
    // return value alone.
    const settingsRead = await supabase
      .from("business_settings")
      .select("business_id")
      .eq("business_id", business.id)
      .maybeSingle()
    const hostsRead = await supabase.from("booking_hosts").select("id").eq("business_id", business.id)
    record(
      "create_business() also wrote business_settings + booking_hosts atomically",
      Boolean(settingsRead.data) && (hostsRead.data?.length ?? 0) > 0,
      `business_settings row=${Boolean(settingsRead.data)}, booking_hosts rows=${hostsRead.data?.length ?? 0}`,
    )

    // ---------------------------------------------------------------------
    // Step 2 — a funnel whose slug COLLIDES with an existing platform
    // funnel, plus a published step and version. Find a real platform
    // funnel at runtime rather than hard-coding a slug, so this script stays
    // correct as the dev clone's data changes.
    // ---------------------------------------------------------------------
    const platformFunnelsRead = await supabase
      .from("funnels")
      .select("id, slug, name")
      .eq("business_id", platformId)
      .eq("status", "published")
      .limit(50)
    if (platformFunnelsRead.error)
      throw new Error(`reading platform funnels failed: ${platformFunnelsRead.error.message}`)

    type FunnelRow = { id: string; slug: string; name: string }
    let platformFunnel: FunnelRow | null = null
    for (const row of (platformFunnelsRead.data ?? []) as FunnelRow[]) {
      const stepRead = await supabase
        .from("funnel_steps")
        .select("published_version_id")
        .eq("funnel_id", row.id)
        .eq("is_entry", true)
        .maybeSingle()
      if (stepRead.data && (stepRead.data as { published_version_id: string | null }).published_version_id) {
        platformFunnel = row
        break
      }
    }
    if (!platformFunnel) {
      throw new Error(
        "no published platform funnel with a live entry step was found in the dev clone — nothing to collide with",
      )
    }
    console.log(`  colliding with platform funnel "${platformFunnel.name}" (slug="${platformFunnel.slug}")`)

    const collision = await createFunnel(businessBId, {
      slug: platformFunnel.slug,
      // No double quotes in the name: React escapes them to &quot; in the
      // rendered HTML, which would silently defeat a raw .includes() check
      // against this exact string further down (found by hand while
      // debugging this script — the embed was fine, the assertion wasn't).
      name: `G31 Tenancy Proof — collides with ${platformFunnel.slug}`,
      kind: "funnel",
    })
    createdFunnelIds.push(collision.id)
    record(
      "create tenant B funnel with the SAME slug as a platform funnel",
      collision.slug.toLowerCase() === platformFunnel.slug.toLowerCase(),
      `tenant B funnel id=${collision.id}, slug=${collision.slug} — illegal before migration 00278, legal after`,
    )

    const collisionPublish = await publishStep(businessBId, {
      stepId: collision.entryStepId,
      html: `<div class="g31-proof-marker"><h1>G31 TENANCY PROOF — TENANT B PAGE</h1><p>slug: ${platformFunnel.slug}</p></div>`,
      css: ".g31-proof-marker { padding: 24px; }",
    })
    must(collisionPublish.ok, "publishStep() for tenant B's colliding step succeeded")
    await updateFunnel(businessBId, collision.id, { status: "published" })

    // A lead against the colliding funnel, for the leads-inbox / PGRST201
    // check below — an inbox with zero rows would never exercise the embed.
    const submission = await createSubmission(businessBId, {
      funnel_id: collision.id,
      step_id: collision.entryStepId,
      form_key: "g31-proof-form",
      email: "g31-proof-lead@example.test",
      name: "G31 Proof Lead",
      payload: { source: "scripts/verify-funnel-tenancy.ts" },
    })
    record("create a lead against tenant B's funnel", Boolean(submission.id), `funnel_submissions.id=${submission.id}`)

    // A second, EXCLUSIVE funnel — a slug only tenant B owns at all, for the
    // "wrong tenant" 404 (as opposed to "slug doesn't exist anywhere") check.
    const exclusiveSlug = `g31-proof-exclusive-${STAMP}`
    const exclusive = await createFunnel(businessBId, {
      slug: exclusiveSlug,
      name: "G31 Tenancy Proof — tenant B exclusive page",
      kind: "page",
    })
    createdFunnelIds.push(exclusive.id)
    const exclusivePublish = await publishStep(businessBId, {
      stepId: exclusive.entryStepId,
      html: `<h1>G31 TENANCY PROOF — TENANT B EXCLUSIVE PAGE</h1>`,
      css: "",
    })
    must(exclusivePublish.ok, "publishStep() for tenant B's exclusive step succeeded")
    await updateFunnel(businessBId, exclusive.id, { status: "published" })

    // ---------------------------------------------------------------------
    // Step 3 — a business_domains row for a host we can send in a Host
    // header. No DAL writer exists for this table yet (the domain
    // management surface doesn't exist — see CLAUDE.md's "three things a
    // white-label SaaS needs"), so this is a direct insert, exactly like
    // migration 00251's platform seed.
    // ---------------------------------------------------------------------
    const tenantBHost = `g31-proof-${STAMP}.localhost`
    const domainInsert = await supabase
      .from("business_domains")
      .insert({ business_id: businessBId, host: tenantBHost, kind: "primary" })
      .select("id")
      .single()
    if (domainInsert.error) throw new Error(`business_domains insert failed: ${domainInsert.error.message}`)
    createdDomainId = (domainInsert.data as { id: string }).id
    record("claim a host for tenant B in business_domains", true, `host="${tenantBHost}" -> business ${businessBId}`)

    // An event tenant B owns — published, upcoming — for the builder's event
    // CTA catalogue check.
    const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const event = await createEvent(businessBId, {
      type: "clinic",
      slug: `g31-proof-clinic-${STAMP}`,
      title: "G31 Tenancy Proof Clinic",
      summary: "Fixture event for the G31 two-tenant verification script. Safe to delete.",
      description:
        "Fixture event for the G31 two-tenant verification script (scripts/verify-funnel-tenancy.ts). Safe to delete.",
      focus_areas: [],
      audience: [],
      location_name: "G31 Proof Location",
      capacity: 10,
      status: "published",
      start_date: startsAt,
    })
    createdEventId = event.id
    record("create a published, upcoming event owned by tenant B", true, `events.id=${event.id}, slug=${event.slug}`)

    // -----------------------------------------------------------------------
    // WHAT TO PROVE — drive the real routes over real HTTP.
    // -----------------------------------------------------------------------
    console.log("\n=== Driving the real routes ===\n")

    // Seeded in migration 00251 for the platform business.
    const platformHost = "www.darrenjpaul.com"
    const unclaimedHost = `g31-proof-unclaimed-${STAMP}.localhost`

    const goA = await rawGet({ host: platformHost, path: `/go/${platformFunnel.slug}` })
    record(
      "/go/<shared-slug> with tenant A's (platform's) host -> A's page",
      goA.status === 200 && !goA.body.includes("G31 TENANCY PROOF"),
      `status=${goA.status}, body contains tenant-B marker=${goA.body.includes("G31 TENANCY PROOF")}`,
    )

    const goB = await rawGet({ host: tenantBHost, path: `/go/${platformFunnel.slug}` })
    record(
      "/go/<shared-slug> with tenant B's host -> B's page (same URL, different page)",
      goB.status === 200 && goB.body.includes("G31 TENANCY PROOF — TENANT B PAGE"),
      `status=${goB.status}, body contains tenant-B marker=${goB.body.includes("G31 TENANCY PROOF — TENANT B PAGE")}`,
    )

    const goUnclaimed = await rawGet({ host: unclaimedHost, path: `/go/${platformFunnel.slug}` })
    record(
      "/go/<shared-slug> with an UNCLAIMED host -> the platform's page, not a 404",
      goUnclaimed.status === 200 && !goUnclaimed.body.includes("G31 TENANCY PROOF"),
      `status=${goUnclaimed.status}, body contains tenant-B marker=${goUnclaimed.body.includes("G31 TENANCY PROOF")}`,
    )

    const goExclusiveAsA = await rawGet({ host: platformHost, path: `/go/${exclusiveSlug}` })
    record(
      "/go/<a-slug-only-B-owns> with tenant A's host -> 404",
      goExclusiveAsA.status === 404,
      `status=${goExclusiveAsA.status}`,
    )

    // Control: the SAME slug resolves for tenant B — proves the 404 above is
    // a tenancy boundary, not "this slug doesn't exist anywhere".
    const goExclusiveAsB = await rawGet({ host: tenantBHost, path: `/go/${exclusiveSlug}` })
    record(
      "control: /go/<a-slug-only-B-owns> with tenant B's own host -> 200",
      goExclusiveAsB.status === 200 && goExclusiveAsB.body.includes("TENANT B EXCLUSIVE PAGE"),
      `status=${goExclusiveAsB.status}`,
    )

    // -------------------------------------------------------------------
    // Admin surfaces need a session. Sign in via the dev-only bypass and
    // hold the cookie for the rest of the run.
    // -------------------------------------------------------------------
    let sessionCookie = ""
    try {
      const loginRes = await fetch(`${APP}/api/dev/login?callbackUrl=/admin/dashboard`, { redirect: "manual" })
      const setCookies = loginRes.headers.getSetCookie()
      const tokenCookie = setCookies.find((c) => c.startsWith("authjs.session-token="))
      if (!tokenCookie) throw new Error(`no authjs.session-token in Set-Cookie (status ${loginRes.status})`)
      sessionCookie = tokenCookie.split(";")[0] ?? ""
      record(
        "authenticate as the seeded admin via /api/dev/login (dev-only bypass)",
        sessionCookie.length > 0,
        "obtained authjs.session-token",
      )
    } catch (err) {
      record(
        "authenticate as the seeded admin via /api/dev/login (dev-only bypass)",
        false,
        err instanceof Error ? err.message : String(err),
      )
    }

    if (sessionCookie.length > 0) {
      const cookieFor = (businessId: string): string => `${sessionCookie}; djp_business=${businessId}`

      // The leads inbox — must render, page column populated (PGRST201 check).
      const leadsRes = await fetch(`${APP}/admin/funnels/leads?funnelId=${collision.id}`, {
        headers: { Cookie: cookieFor(businessBId) },
      })
      const leadsBody = await leadsRes.text()
      const pageColumnPopulated = leadsBody.includes(collision.name)
      record(
        "leads inbox renders for tenant B with the PAGE COLUMN populated (the PGRST201 check)",
        leadsRes.status === 200 && pageColumnPopulated,
        `status=${leadsRes.status}, body contains funnel name "${collision.name}"=${pageColumnPopulated}`,
      )

      // The same funnelId under tenant A's own session must show nothing —
      // the funnel_submissions predicate applies even when the id is real.
      const leadsAsA = await fetch(`${APP}/admin/funnels/leads?funnelId=${collision.id}`, {
        headers: { Cookie: cookieFor(platformId) },
      })
      const leadsAsABody = await leadsAsA.text()
      record(
        "the same lead is invisible from tenant A's own session",
        leadsAsA.status === 200 && !leadsAsABody.includes("g31-proof-lead@example.test"),
        `status=${leadsAsA.status}, body contains tenant-B lead email=${leadsAsABody.includes("g31-proof-lead@example.test")}`,
      )

      // The builder's event CTA catalogue — only the asking tenant's events.
      const offersB = await fetch(`${APP}/api/admin/funnels/offers?kind=event`, {
        headers: { Cookie: cookieFor(businessBId) },
      })
      const offersBJson = (await offersB.json()) as OffersResponse
      const bIds = (offersBJson.offers ?? []).map((o) => o.id)
      record(
        "event CTA catalogue for tenant B includes tenant B's own event",
        offersB.status === 200 && bIds.includes(event.id),
        `status=${offersB.status}, ids=${JSON.stringify(bIds)}`,
      )

      const offersA = await fetch(`${APP}/api/admin/funnels/offers?kind=event`, {
        headers: { Cookie: cookieFor(platformId) },
      })
      const offersAJson = (await offersA.json()) as OffersResponse
      const aIds = (offersAJson.offers ?? []).map((o) => o.id)
      record(
        "event CTA catalogue for tenant A (platform) does NOT include tenant B's event",
        offersA.status === 200 && !aIds.includes(event.id),
        `status=${offersA.status}, count=${aIds.length}, includes tenant-B event=${aIds.includes(event.id)}`,
      )

      // /admin/funnels board, scoped per tenant — bonus coverage beyond the
      // brief's minimum, cheap given the session is already held open.
      const boardB = await fetch(`${APP}/admin/funnels`, { headers: { Cookie: cookieFor(businessBId) } })
      const boardBBody = await boardB.text()
      const boardA = await fetch(`${APP}/admin/funnels`, { headers: { Cookie: cookieFor(platformId) } })
      const boardABody = await boardA.text()
      record(
        "/admin/funnels as tenant B shows tenant B's colliding funnel, not visible from tenant A",
        boardBBody.includes(collision.name) && !boardABody.includes(collision.name),
        `B board has it=${boardBBody.includes(collision.name)}, A board has it=${boardABody.includes(collision.name)}`,
      )
      record(
        "/admin/funnels as tenant A still shows the platform's own funnel at that slug",
        boardABody.includes(platformFunnel.name),
        `A board has platform funnel name=${boardABody.includes(platformFunnel.name)}`,
      )
    }
  } finally {
    // -----------------------------------------------------------------------
    // CLEANUP. Order matters: `funnels.business_id` and `events.business_id`
    // reference businesses(id) with NO on-delete-cascade (migrations 00278
    // and 00252 both say so explicitly) — deleting the business first would
    // raise a foreign_key_violation. business_settings, booking_hosts,
    // business_members and business_domains DO cascade off the businesses
    // row (00212/00240), so only the business delete is needed for those.
    // -----------------------------------------------------------------------
    console.log("\n=== Cleanup ===")
    const supabase = (await import("@/lib/supabase")).createServiceRoleClient()

    for (const id of createdFunnelIds) {
      const del = await supabase.from("funnels").delete().eq("id", id)
      console.log(
        `  delete funnels.id=${id}: ${del.error ? "FAILED " + del.error.message : "ok (cascades steps/versions/submissions)"}`,
      )
    }
    if (createdEventId) {
      const del = await supabase.from("events").delete().eq("id", createdEventId)
      console.log(`  delete events.id=${createdEventId}: ${del.error ? "FAILED " + del.error.message : "ok"}`)
    }
    if (createdDomainId) {
      const del = await supabase.from("business_domains").delete().eq("id", createdDomainId)
      console.log(
        `  delete business_domains.id=${createdDomainId}: ${del.error ? "FAILED " + del.error.message : "ok (the business delete below would also cascade this)"}`,
      )
    }
    if (businessBId) {
      const del = await supabase.from("businesses").delete().eq("id", businessBId)
      console.log(
        `  delete businesses.id=${businessBId}: ${del.error ? "FAILED " + del.error.message : "ok (cascades business_settings/booking_hosts/business_members)"}`,
      )
    }

    // Verify the cleanup by RE-READING, not by trusting the delete calls above.
    if (businessBId) {
      const [bizRead, funnelsRead, eventsRead, domainsRead, settingsRead2, membersRead, hostsRead2] = await Promise.all(
        [
          supabase.from("businesses").select("id").eq("id", businessBId).maybeSingle(),
          supabase.from("funnels").select("id").eq("business_id", businessBId),
          supabase.from("events").select("id").eq("business_id", businessBId),
          supabase.from("business_domains").select("id").eq("business_id", businessBId),
          supabase.from("business_settings").select("business_id").eq("business_id", businessBId).maybeSingle(),
          supabase.from("business_members").select("user_id").eq("business_id", businessBId),
          supabase.from("booking_hosts").select("id").eq("business_id", businessBId),
        ],
      )
      const remnants = {
        businesses: bizRead.data ? 1 : 0,
        funnels: funnelsRead.data?.length ?? 0,
        events: eventsRead.data?.length ?? 0,
        business_domains: domainsRead.data?.length ?? 0,
        business_settings: settingsRead2.data ? 1 : 0,
        business_members: membersRead.data?.length ?? 0,
        booking_hosts: hostsRead2.data?.length ?? 0,
      }
      const clean = Object.values(remnants).every((n) => n === 0)
      record("cleanup verified by re-reading every table touched", clean, JSON.stringify(remnants))
      if (!clean) {
        console.error(
          `\n!!! CLEANUP INCOMPLETE for business ${businessBId} — rows left behind: ${JSON.stringify(remnants)} !!!\n`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------
  console.log("\n=== Summary ===")
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} — ${r.label}`)
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${results.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log(`\nAll ${results.length} checks passed.`)
  }
}

main().catch((error) => {
  console.error("\nSCRIPT FAILED:", error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
