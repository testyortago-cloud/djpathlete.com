// Server wrapper for the Step Up For Students inquiry form. Mirrors
// components/public/InquiryForm.tsx exactly — see that file's header comment
// for the full reasoning on why the wording is fetched here instead of in
// components/funnels/islands/FormIsland.tsx-style separate island. This form
// has exactly one call site (app/(marketing)/step-up-for-students/page.tsx,
// itself a server component), so this wrapper IS that page's server parent.

import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { StepUpInquiryFormClient } from "./StepUpInquiryFormClient"
import { resolvePublicTenant } from "@/lib/tenancy/public"

export async function StepUpInquiryForm() {
  // See InquiryForm.tsx for the full "failed read and blank name both
  // degrade to no checkbox" reasoning — identical here.
  //
  // Same business as the route that files the consent row: both resolve it
  // from the request's Host through lib/tenancy/public.ts.
  const businessId = await resolvePublicTenant()
  const businessSettings = await getBusinessSettings(businessId).catch(() => null)
  const displayName = businessSettings?.display_name
  const smsConsentWording = hasSmsConsentDisplayName(displayName) ? renderSmsConsentWording(displayName) : undefined

  return <StepUpInquiryFormClient smsConsentWording={smsConsentWording} />
}
