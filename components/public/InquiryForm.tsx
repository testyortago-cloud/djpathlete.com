// Server wrapper for the public application/inquiry form. Keeps the
// interactive shell in a client component (InquiryFormClient) while fetching
// the SMS consent wording server-side — mirrors
// components/funnels/islands/FormIsland.tsx's fetch-and-thread pattern
// exactly, just collapsed into one file instead of two, since this form has
// no separate "island" layer of its own.
//
// InquiryForm is rendered directly from six marketing pages
// (assessment/camps/clinics/in-person/online/programs), each a server
// component today, so each of them already IS this form's server parent —
// no client boundary to cross. Fetching here, once, keeps every call site
// unchanged (same import, same props) rather than repeating the
// getBusinessSettings + hasSmsConsentDisplayName dance six times.

import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { InquiryFormClient } from "./InquiryFormClient"
import type { ServiceType } from "@/lib/validators/inquiry"

interface InquiryFormProps {
  /** Pre-select the service type based on which page the form is on */
  defaultService?: ServiceType
  /** Heading to show above the form */
  heading?: string
  /** Description below the heading */
  description?: string
}

export async function InquiryForm({ defaultService, heading, description }: InquiryFormProps) {
  // THE SMS CONSENT WORDING IS FETCHED SERVER-SIDE, using the EXACT same
  // input (`display_name`) the route re-renders from, so
  // `contact_consents.wording_shown` reproduces what the visitor actually
  // saw.
  //
  // A FAILED READ AND A BLANK NAME BOTH DEGRADE TO NO CHECKBOX, never to a
  // checkbox with broken wording. `business_settings.display_name` is
  // seeded `''` on any install nobody has configured yet, and rendering
  // that straight through would show a visitor "I agree to receive text
  // messages from about my inquiry" — a sentence that cannot name the
  // business is not valid consent wording. `hasSmsConsentDisplayName` is
  // the same gate the route checks before filing the consent row, so "the
  // name was unusable" can never mean one thing here and a different thing
  // there.
  const businessSettings = await getBusinessSettings().catch(() => null)
  const displayName = businessSettings?.display_name
  const smsConsentWording = hasSmsConsentDisplayName(displayName) ? renderSmsConsentWording(displayName) : undefined

  return (
    <InquiryFormClient
      defaultService={defaultService}
      heading={heading}
      description={description}
      smsConsentWording={smsConsentWording}
    />
  )
}
