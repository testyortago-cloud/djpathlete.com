// Server wrapper for the opt-in form. Keeps the interactive shell in a client
// component while the surrounding page stays server-rendered.

import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"
import { getBusinessSettings, type BusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
import { hasEmailConsentDisplayName, renderEmailConsentWording } from "@/lib/lead-engine/email-consent-wording"
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { FunnelForm } from "./FunnelForm"
import type { FunnelRenderContext } from "./index"
import type { FunnelFormField } from "@/lib/funnels/islands"

interface FormIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function FormIsland({ props, context }: FormIslandProps) {
  const fields = (props.fields as FunnelFormField[]) ?? []

  // THE WAIVER IS FETCHED ONLY FOR A CHECKOUT FORM. Every lead-gen form in the
  // app renders through here too, and a legal_documents read on each of them
  // would be a query bought for nothing.
  //
  // Prepared exactly as app/(marketing)/camps/[slug]/page.tsx prepares it — same
  // reader, same renderer — so the funnel and the event page show one document
  // one way. `null` when nothing is active, which FunnelForm turns into a link.
  const waiverDoc = props.successMode === "checkout" ? await getActiveDocument("liability_waiver") : null
  const waiverHtml = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null

  // THE SMS/EMAIL CONSENT WORDING IS FETCHED ONLY WHEN THE FORM HAS A PHONE
  // OR AN EMAIL FIELD (decision 7 widened this from "a phone field" alone,
  // so a form with only an email field still gets the email consent tick) —
  // same reasoning as the waiver above, a business_settings read bought for
  // nothing on a form with neither to attach a tick to.
  //
  // `/go` (the funnel page component) does not load business_settings today,
  // so this island — already an async server component doing exactly this
  // kind of "prepare it here, hand the client a rendered prop" work for the
  // waiver — is the cleanest existing channel: no client fetch, no widening
  // the page's own data needs. `renderSmsConsentWording` is called with the
  // EXACT same input (`display_name`) the submit route re-renders from, so
  // `contact_consents.wording_shown` reproduces what the visitor actually saw.
  //
  // A FAILED READ AND A BLANK NAME BOTH DEGRADE TO NO CHECKBOX, never to a
  // checkbox with broken wording. `business_settings.display_name` is seeded
  // `''` on any install nobody has configured yet, and rendering that
  // straight through would show a visitor "I agree to receive text messages
  // from about my inquiry" — a sentence that cannot name the business is not
  // valid consent wording. `hasSmsConsentDisplayName` is the same gate the
  // submit route checks before filing the consent row, so "the name was
  // unusable" can never mean one thing here and a different thing there.
  //
  // Read for the SAME business the submit route files the consent row under:
  // both resolve it from the request's Host through lib/tenancy/public.ts, so
  // the wording shown and the wording filed cannot name different businesses.
  // Resolved when there is a phone field OR an email field — a form with
  // neither costs no read.
  // Each wording is gated on its OWN field type, not merely on the read
  // having happened: a form with an email field but no tel field must not
  // get a defined `smsConsentWording` just because the (now-widened) read
  // fired for the email tick's sake, and vice versa.
  const hasTelField = fields.some((field) => field.type === "tel")
  const hasEmailField = fields.some((field) => field.type === "email")

  let businessSettings: BusinessSettings | null = null
  if (hasTelField || hasEmailField) {
    const businessId = await resolvePublicTenant()
    businessSettings = await getBusinessSettings(businessId).catch(() => null)
  }
  const displayName = businessSettings?.display_name
  const smsConsentWording =
    hasTelField && hasSmsConsentDisplayName(displayName) ? renderSmsConsentWording(displayName) : undefined
  const emailConsentWording =
    hasEmailField && hasEmailConsentDisplayName(displayName) ? renderEmailConsentWording(displayName) : undefined

  return (
    <FunnelForm
      funnelId={context.funnelId}
      stepId={context.stepId}
      isPreview={context.isPreview}
      testRun={context.testRun}
      formKey={String(props.formKey ?? "optin")}
      fields={fields}
      submitLabel={String(props.submitLabel ?? "Submit")}
      successMode={
        props.successMode === "redirect" ? "redirect" : props.successMode === "checkout" ? "checkout" : "message"
      }
      waiverHtml={waiverHtml}
      smsConsentWording={smsConsentWording}
      emailConsentWording={emailConsentWording}
      successMessage={typeof props.successMessage === "string" ? props.successMessage : "Thanks — you're in."}
      redirectUrl={typeof props.redirectUrl === "string" ? props.redirectUrl : undefined}
      consentText={typeof props.consentText === "string" ? props.consentText : undefined}
      // The paths FunnelForm stamps (`submitLabel`, `fields.0.label`) are
      // relative to the SECTION's props, and they are correct without any
      // rewriting here because a form section's props ARE this island's props:
      // `formSectionPropsSchema` is `{heading, sub, proofPoints}` INTERSECTED
      // with `formIslandSchema`, and `renderFormSection` passes the rest
      // through verbatim. If that ever becomes a nested object, every path
      // below needs a prefix.
      editable={context.editable === true}
    />
  )
}
