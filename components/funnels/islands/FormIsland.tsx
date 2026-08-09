// Server wrapper for the opt-in form. Keeps the interactive shell in a client
// component while the surrounding page stays server-rendered.

import { FunnelForm } from "./FunnelForm"
import type { FunnelRenderContext } from "./index"
import type { FunnelFormField } from "@/lib/funnels/islands"

interface FormIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export function FormIsland({ props, context }: FormIslandProps) {
  return (
    <FunnelForm
      funnelId={context.funnelId}
      stepId={context.stepId}
      isPreview={context.isPreview}
      formKey={String(props.formKey ?? "optin")}
      fields={(props.fields as FunnelFormField[]) ?? []}
      submitLabel={String(props.submitLabel ?? "Submit")}
      successMode={props.successMode === "redirect" ? "redirect" : "message"}
      successMessage={
        typeof props.successMessage === "string" ? props.successMessage : "Thanks — you're in."
      }
      redirectUrl={typeof props.redirectUrl === "string" ? props.redirectUrl : undefined}
      consentText={typeof props.consentText === "string" ? props.consentText : undefined}
    />
  )
}
