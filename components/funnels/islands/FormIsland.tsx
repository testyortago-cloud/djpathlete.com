// Server wrapper for the opt-in form. Keeps the interactive shell in a client
// component while the surrounding page stays server-rendered.

import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"
import { getBusinessSettings } from "@/lib/db/businesses"
import { hasSmsConsentDisplayName, renderSmsConsentWording } from "@/lib/lead-engine/sms-consent-wording"
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

  // THE SMS CONSENT WORDING IS FETCHED ONLY WHEN THE FORM HAS A PHONE FIELD —
  // same reasoning as the waiver above, a business_settings read bought for
  // nothing on a form with no phone to text.
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
  const businessSettings = fields.some((field) => field.type === "tel")
    ? await getBusinessSettings().catch(() => null)
    : null
  const displayName = businessSettings?.display_name
  const smsConsentWording = hasSmsConsentDisplayName(displayName) ? renderSmsConsentWording(displayName) : undefined

  return (
    <FunnelForm
      funnelId={context.funnelId}
      stepId={context.stepId}
      isPreview={context.isPreview}
      formKey={String(props.formKey ?? "optin")}
      fields={fields}
      submitLabel={String(props.submitLabel ?? "Submit")}
      successMode={
        props.successMode === "redirect" ? "redirect" : props.successMode === "checkout" ? "checkout" : "message"
      }
      waiverHtml={waiverHtml}
      smsConsentWording={smsConsentWording}
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
