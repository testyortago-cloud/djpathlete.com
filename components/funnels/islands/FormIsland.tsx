// Server wrapper for the opt-in form. Keeps the interactive shell in a client
// component while the surrounding page stays server-rendered.

import { getActiveDocument } from "@/lib/db/legal-documents"
import { renderLegalContent } from "@/lib/legal-content"
import { FunnelForm } from "./FunnelForm"
import type { FunnelRenderContext } from "./index"
import type { FunnelFormField } from "@/lib/funnels/islands"

interface FormIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function FormIsland({ props, context }: FormIslandProps) {
  // THE WAIVER IS FETCHED ONLY FOR A CHECKOUT FORM. Every lead-gen form in the
  // app renders through here too, and a legal_documents read on each of them
  // would be a query bought for nothing.
  //
  // Prepared exactly as app/(marketing)/camps/[slug]/page.tsx prepares it — same
  // reader, same renderer — so the funnel and the event page show one document
  // one way. `null` when nothing is active, which FunnelForm turns into a link.
  const waiverDoc = props.successMode === "checkout" ? await getActiveDocument("liability_waiver") : null
  const waiverHtml = waiverDoc?.content ? renderLegalContent(waiverDoc.content) : null

  return (
    <FunnelForm
      funnelId={context.funnelId}
      stepId={context.stepId}
      isPreview={context.isPreview}
      formKey={String(props.formKey ?? "optin")}
      fields={(props.fields as FunnelFormField[]) ?? []}
      submitLabel={String(props.submitLabel ?? "Submit")}
      successMode={
        props.successMode === "redirect" ? "redirect" : props.successMode === "checkout" ? "checkout" : "message"
      }
      waiverHtml={waiverHtml}
      successMessage={
        typeof props.successMessage === "string" ? props.successMessage : "Thanks — you're in."
      }
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
