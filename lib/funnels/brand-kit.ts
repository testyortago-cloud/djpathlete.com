// lib/funnels/brand-kit.ts — the tenant brand kit for the page builder's
// palette default (migration 00260's `business_settings.brand_color` /
// `.accent_color`; Task 4's `themeCss` fallback in `lib/funnels/sections/doc.ts`).
//
// A THIN, UNWRAPPED READ, DELIBERATELY. Every caller of `reassemble` that
// renders a page for a human (the build route, both draft previews, the
// funnel-wide publish route, the single-step publish server action, and the
// admin editor's compile-status twin) already owns a degradation shape for
// its OTHER dependencies — `loadCatalogues` and `resolveDoc` both throw and
// are both wrapped at the call site, never here. This function throws exactly
// as `getBusinessSettings` does, and wrapping it a sixth time in a shape this
// file invents would be exactly the "restating a rule instead of calling the
// thing that owns it" mistake this repo has already shipped three bugs from.
// Each call site wraps this the same way it already wraps its other reads.

import { getBusinessSettings } from "@/lib/db/businesses"
import type { BrandKit } from "@/lib/funnels/sections/render"

/**
 * `null` when the tenant has not chosen a brand (`brand_color` is NULL and
 * never defaulted — see `lib/db/businesses.ts`'s own comment on the column),
 * never when the read merely failed; a failed read is the caller's throw to
 * catch. `accent` is optional on `BrandKit`; `resolvePalette` derives one from
 * `brand` alone when it is absent.
 */
export async function resolveBrandKit(businessId: string): Promise<BrandKit | null> {
  const settings = await getBusinessSettings(businessId)
  if (!settings.brand_color) return null
  return { brand: settings.brand_color, accent: settings.accent_color ?? undefined }
}
