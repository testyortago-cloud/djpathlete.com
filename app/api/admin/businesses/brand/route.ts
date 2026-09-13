// app/api/admin/businesses/brand/route.ts — the WRITER for
// `business_settings.brand_color` / `.accent_color` (migration 00260).
//
// This is the tenant brand kit the page builder's `ThemePanel` offers as "my
// brand colours" (design spec §7 / §7a) and `resolveBrandKit` reads for
// `themeCss`'s palette default. A column with no writer is a labelling gap —
// this route is that writer, and it is the ONLY one: nothing else in the app
// sets either column.
//
// ---------------------------------------------------------------------------
// THREE GUARDS ON THE SAME TWO STRINGS, DELIBERATELY
// ---------------------------------------------------------------------------
// Every hex value this route accepts eventually reaches a `--brand: <value>`
// CSS custom property (`lib/funnels/sections/palettes.ts`'s own header says
// so), and `safeStyle` does NOT reject `url(...)`. So the SAME
// `^#[0-9a-fA-F]{6}$` shape is checked three times on purpose, not
// redundantly: here (before a single byte reaches the database), by the
// `business_settings_brand_color_hex` / `_accent_color_hex` CHECK constraints
// (migration 00260, belt for a caller that bypasses this route), and again by
// `assertHex` inside `resolvePalette` the moment either column is READ back
// for a render. Losing any one of the three would make CSS injection depend
// on the other two never having a gap — which is exactly the reasoning this
// repo's `hexColor` schema in `registry.ts` already gives for the same
// pattern on a section's own colours.
//
// ---------------------------------------------------------------------------
// THE TENANT IS RESOLVED, NEVER NAMED IN THE BODY
// ---------------------------------------------------------------------------
// Unlike `PATCH /api/admin/businesses/[id]`, this route takes no `id` — it
// always writes `resolveAdminTenantForRequest`'s own `businessId`, the
// caller's currently-selected tenant. A body-supplied id would be exactly the
// ambient-authority shape CLAUDE.md's tenancy section warns against: this repo
// is moving every per-tenant write onto "resolve it the way every other
// per-tenant reader does," not adding a new place that trusts the caller to
// say which tenant they mean.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { updateBusinessSettings } from "@/lib/db/businesses"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { withAudit } from "@/lib/audit/with-audit"

// The exact shape `paletteSchema`'s `hexColor` and migration 00260's CHECK
// constraints both use — see the file banner. Never loosen this to "looks
// like a colour"; a model or an owner can type anything into a colour picker
// that got proxied through a text box, and this is what actually stands
// between that string and CSS injection.
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const hexColor = z.string().regex(HEX_RE, "Colour must be a six-digit hex like #3a7d44")

const bodySchema = z.object({
  brand_color: hexColor,
  // Nullable, not optional: `accent_color` can be cleared back to "derive it
  // from brand" (`resolvePalette` does that when `accent` is absent) without
  // touching `brand_color`, which is why a bare omission is not accepted here
  // — the panel always sends its actual intent, never "leave unspecified".
  accent_color: hexColor.nullable(),
})

export const POST = withAudit(
  {
    action: "business.brand_kit_updated",
    category: "admin_write",
    target: (_req, _ctx, res) => {
      const id = res?.headers.get("x-audit-target-id")
      return id ? { type: "business", id } : undefined
    },
  },
  async (request: Request) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // `resolveAdminTenantForRequest` already restricts to admin/staff roles
    // (`ADMIN_PANEL_ROLES`) and to a business this caller may actually act
    // on — the same guard `PATCH /api/admin/businesses/[id]` uses for the
    // rest of `business_settings`.
    let tenant
    try {
      tenant = await resolveAdminTenantForRequest(request)
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a six-digit hex colour like #3a7d44 for each field" }, { status: 400 })
    }

    const settings = await updateBusinessSettings(
      { brand_color: parsed.data.brand_color, accent_color: parsed.data.accent_color },
      tenant.businessId,
    )

    const response = NextResponse.json({ brand_color: settings.brand_color, accent_color: settings.accent_color })
    response.headers.set("x-audit-target-id", tenant.businessId)
    return response
  },
)
