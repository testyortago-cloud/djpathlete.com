// lib/validators/chat.ts — what the public chat endpoints will accept off the
// wire. Everything here is hostile input: `/api/ask` and `/api/ask/capture`
// are unauthenticated, and the browser is not a source of truth about
// anything.
//
// Task 7 adds `askRequestSchema` (the turn endpoint's body) to this file.

import { z } from "zod"

/**
 * The details card renders a name field, an email field and a phone field, and
 * the visitor fills in whichever they prefer — so the untouched input posts
 * `""`. An empty string is the ABSENCE of an answer, not an answer, and
 * feeding it to `.email()` would reject a perfectly good phone-only
 * submission. Normalising it away here also keeps `""` out of the contact
 * spine, where a blank phone column is worse than no phone column.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value

/**
 * The body of `POST /api/ask/capture` — the one route in this feature that can
 * create a contact.
 *
 * THERE IS NO `wordingShown` FIELD, AND THAT IS THE POINT. The consent
 * sentence filed on `contact_consents.wording_shown` is re-rendered
 * server-side from `business_settings.display_name` through the same resolver
 * the card used to display it (`lib/lead-engine/chat/consent-wording.ts`).
 * A consent record quoting text the browser supplied is evidence of nothing —
 * it says only that the browser was willing to type a sentence. Zod strips
 * unknown keys, so a payload carrying one loses it here rather than downstream.
 *
 * The `.refine` is load-bearing rather than decorative: `captureLead` returns
 * `null` when handed neither an email nor a phone, so without it a submission
 * with only a name would be accepted, record nothing, and report success. A
 * rejected form is a far better outcome than a silent one.
 *
 * It is a `.refine` on the OBJECT, and it indexes nothing. Zod 4 keeps running
 * checks after an earlier one has failed, so a refinement that reached into an
 * array or dereferenced a field it assumed was validated could throw during
 * parsing — turning a 400 into a 500. Measured against Zod 4.3.6: an object
 * whose fields fail does not reach this refinement at all, and a non-object
 * body (`null`, a string, a number) aborts before it too.
 */
export const askCaptureSchema = z
  .object({
    conversationId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    email: z.preprocess(blankToUndefined, z.string().trim().email().max(200).optional()),
    phone: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
    /**
     * The optional tick, and a SEPARATE agreement from submitting the form at
     * all. Required on the wire rather than defaulted: a client that forgets
     * to send it has a bug worth a 400, not a silent answer invented on its
     * behalf.
     */
    marketingConsent: z.boolean(),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "An email address or a phone number is required.",
  })

export type AskCaptureInput = z.infer<typeof askCaptureSchema>
