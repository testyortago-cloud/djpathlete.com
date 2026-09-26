"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"

/**
 * The submit button for the consent form, and the ONLY reason this route has a
 * client component at all.
 *
 * `confirmSmsConsent` is check-then-insert with nothing behind it:
 * `contact_consents` has no unique constraint, and it should not have one — it
 * is an append-only log in which one person legitimately holds many rows
 * (agreed, revoked, agreed again). So two presses that overlap both read "no
 * consent on file" and both insert, and one act of agreement ends up recorded
 * as two granted consent rows, two timeline events and two audit rows. A
 * compliance trail that overstates what a person did is worth less than no
 * trail; that is the same argument the module header makes about a consent
 * record a mail scanner can manufacture.
 *
 * A plain server-component form gives no sign at all that a press landed — the
 * button looks identical while the request is in flight — so on a slow
 * connection pressing again is the obvious thing to do. `useFormStatus` reads
 * the pending state of the enclosing <form>, which is what lets the button say
 * so and refuse the second press.
 *
 * WHAT THIS DOES NOT COVER, stated plainly because the write's doc comment
 * used to overclaim: this is a UI guard, not a lock. It does nothing before
 * hydration, nothing with JavaScript disabled, and nothing about two presses
 * from two different tabs or devices. It removes the ordinary double-tap,
 * which is the case that actually happens. `hasConsent` still catches every
 * repeat that arrives after the first write has landed.
 */
export function AgreeButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving your answer" : "I agree"}
    </Button>
  )
}
