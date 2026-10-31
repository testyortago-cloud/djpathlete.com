import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getLink, linkAthlete, linkedAthletes, unlinkAthlete } from "@/lib/db/output-sports"
import { listAthletes } from "@/lib/output-sports/api"
import { looksLikeClient } from "@/lib/output-sports/map"
import { outputAccessToken, removeImportedTests, syncClient } from "@/lib/output-sports/sync"
import { outputErrorResponse } from "@/lib/output-sports/errors"

type Ctx = { params: Promise<{ id: string }> }

// A first link reads a year of results from Output in 31-day pieces, then recomputes PRs.
export const maxDuration = 300

/** The caller, their business and the client, or a response saying why not. */
async function contextOr(request: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
    return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
  }
  const { id } = await ctx.params
  const client = await getUserById(id).catch(() => null)
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })
  const { businessId } = await resolveAdminTenantForRequest(request)
  return { userId: session.user.id, businessId, client }
}

const target = async (_req: Request, ctx: unknown) => {
  const { id } = await (ctx as Ctx).params
  return { type: "user", id }
}

/** The Output athletes to pick from, the likely match first. Calls Output, so the page asks for it on demand. */
export async function GET(request: Request, ctx: Ctx) {
  const c = await contextOr(request, ctx)
  if (c instanceof NextResponse) return c
  try {
    const [athletes, taken, profile] = await Promise.all([
      outputAccessToken(c.businessId).then(listAthletes),
      linkedAthletes(c.businessId),
      getProfileByUserId(c.client.id),
    ])
    const who = { ...c.client, date_of_birth: profile?.date_of_birth ?? null }
    const list = athletes
      .map((a) => ({
        id: a.id,
        name: a.fullName?.trim() || `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || "(no name in Output)",
        dateOfBirth: a.dateOfBirth?.slice(0, 10) ?? null,
        suggested: looksLikeClient(a, who),
        linkedToOther: taken.has(a.id) && taken.get(a.id) !== c.client.id,
      }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name))
    return NextResponse.json({ athletes: list })
  } catch (err) {
    return outputErrorResponse(err)
  }
}

const linkSchema = z.object({ athleteId: z.string().min(1).max(200) })

/** Links the client to an Output athlete, then pulls their results in straight away. */
export const POST = withAudit(
  { action: "output_sports.athlete_linked", category: "admin_write", target },
  async (request, context) => {
    const c = await contextOr(request, context as unknown as Ctx)
    if (c instanceof NextResponse) return c
    const parsed = linkSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Pick an Output athlete." }, { status: 400 })

    let athlete
    try {
      // The name comes from Output itself, so a link can only name an athlete that exists there.
      athlete = (await outputAccessToken(c.businessId).then(listAthletes)).find((a) => a.id === parsed.data.athleteId)
    } catch (err) {
      return outputErrorResponse(err)
    }
    if (!athlete) return NextResponse.json({ error: "That athlete is not in your Output account." }, { status: 404 })
    const name = athlete.fullName?.trim() || `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.trim()
    const previous = await getLink(c.businessId, c.client.id)
    // Linking the same athlete again keeps last_synced_at, so it is not a second year-long read.
    if (previous?.output_athlete_id !== athlete.id) {
      const link = await linkAthlete(c.businessId, c.client.id, { id: athlete.id, name }, c.userId)
      if (link === "taken") {
        return NextResponse.json({ error: `${name} is already linked to another client.` }, { status: 409 })
      }
      // Results from the athlete they were linked to before belong to someone else.
      if (previous) await removeImportedTests(c.client.id)
    }

    let summary
    try {
      summary = await syncClient(c.businessId, c.client.id, c.userId)
    } catch (err) {
      // The link is saved either way; the coach can press Sync again.
      const body = await outputErrorResponse(err).json()
      return NextResponse.json({ link: await getLink(c.businessId, c.client.id), syncError: body.error })
    }
    return NextResponse.json({ link: await getLink(c.businessId, c.client.id), summary })
  },
)

/**
 * Unlinks. Results already brought in stay in the client's history, unless `?remove=1`
 * (the coach linked the wrong athlete).
 */
export const DELETE = withAudit(
  { action: "output_sports.athlete_unlinked", category: "admin_write", target },
  async (request, context) => {
    const c = await contextOr(request, context as unknown as Ctx)
    if (c instanceof NextResponse) return c
    await unlinkAthlete(c.businessId, c.client.id)
    if (new URL(request.url).searchParams.get("remove") === "1") await removeImportedTests(c.client.id)
    return NextResponse.json({ ok: true })
  },
)
