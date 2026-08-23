"use server"

// app/(marketing)/sms-consent/[token]/actions.ts — the POST behind the
// "I agree" button, and the ONLY thing on this route that writes.
//
// The page beside this file renders on GET and writes nothing, deliberately:
// corporate mail scanners fetch every link in an inbound message, and a GET
// that recorded consent would let a robot in somebody's mail gateway
// manufacture the evidence that they agreed to be texted. The whole reasoning
// is in lib/lead-engine/sms-consent.ts's header. Keep it that way — anything
// added to the page must stay a read.

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { confirmSmsConsent } from "@/lib/lead-engine/sms-consent"

export async function confirmSmsConsentAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "")

  // Filed on the consent row as evidence of the act, exactly as the funnel
  // form's consent rows carry it. Only the first hop of `x-forwarded-for` is
  // the client; everything after it is a proxy.
  const requestHeaders = await headers()
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = requestHeaders.get("user-agent")

  const outcome = await confirmSmsConsent(token, { ip, userAgent })

  // Back to the page, which re-derives every bit of what it shows from the
  // database. `done` is a presentation flag and nothing more: it chooses
  // between "you're all set" and "you already told us yes", both of which
  // require a real consent row to be reached at all. It is not appended on a
  // refusal, so a suppressed number lands back on the honest STOP copy.
  const target = `/sms-consent/${encodeURIComponent(token)}${outcome.ok ? "?done=1" : ""}`
  redirect(target)
}
