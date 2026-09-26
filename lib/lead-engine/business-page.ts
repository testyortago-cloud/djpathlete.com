// lib/lead-engine/business-page.ts — whose page the unsubscribe and SMS-consent
// links open (G49).
//
// Those links come from a business's own sequence email, and the page they open
// is the next thing the person sees after that email. So it carries the same
// identity the email carries, read the same way: the token's business, its
// `business_settings` row, and `paletteFor` from ./email.ts, so a colour a
// coach picks reaches the page and the email by one rule.
//
// No fallback to anybody else's NAME, ever. A business with no name, or a
// settings row that cannot be read, gets a page with no identity at all: a
// plain page is honest, and another business's name is not.
//
// COLOURS ARE THE ONE FALLBACK, AND IT IS NOT NEUTRAL. A business that has not
// picked a brand colour gets `paletteFor`'s DEFAULT_PALETTE, which is this
// platform's own teal and gold, exactly as its sequence emails do. That keeps
// page and email matching (the owner's choice for G49), but it is the
// platform's palette on every business that has not chosen one. A neutral
// default would have to change the emails too; that is a separate decision,
// recorded as a follow-up on G49 in the ledger.

import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"
import { paletteFor } from "@/lib/lead-engine/email"

export interface BusinessPageIdentity {
  displayName: string
  /** Who "Sent by" names: the sender name, or the business name when that is blank. */
  senderName: string
  postalAddress: string | null
  /**
   * Only an https address; anything else is dropped and the name is shown. Not
   * plain http: on an https page the browser blocks or rewrites it, and the
   * header would show a broken image instead of the name.
   */
  logoUrl: string | null
  palette: { brand: string; brandInk: string; accent: string; strip: string }
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

export function businessPageIdentity(settings: BusinessSettings | null): BusinessPageIdentity | null {
  if (!settings) return null
  const displayName = present(settings.display_name)
  if (!displayName) return null
  const logo = present(settings.logo_url)
  return {
    displayName,
    senderName: present(settings.sender_name) ?? displayName,
    postalAddress: present(settings.postal_address),
    logoUrl: logo && /^https:\/\/\S+$/i.test(logo) ? logo : null,
    palette: paletteFor(settings),
  }
}

/**
 * The identity for a token's business. A failed read is logged and shows the
 * page with no identity: the person still needs their answer.
 */
export async function loadBusinessPageIdentity(businessId: string): Promise<BusinessPageIdentity | null> {
  try {
    return businessPageIdentity(await getBusinessSettings(businessId))
  } catch (error) {
    console.error("[business-page] could not read business settings", businessId, error)
    return null
  }
}
