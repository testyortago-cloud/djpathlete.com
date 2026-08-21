import { z } from "zod"

export const createEventSignupSchema = z.object({
  parent_name: z.string().min(2).max(100),
  parent_email: z.string().email(),
  parent_phone: z.string().min(5).max(30).optional().nullable(),
  athlete_name: z.string().min(2).max(100),
  athlete_age: z.number().int().min(6).max(21),
  sport: z.string().min(1).max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  // Parent/guardian must affirm they've read and agreed to the liability
  // waiver before the signup is accepted. The active legal_documents row of
  // type 'liability_waiver' is what they're agreeing to; the server records
  // the document id and IP/UA at insert time.
  waiver_accepted: z
    .boolean()
    .refine((v) => v === true, { message: "You must accept the liability waiver to sign up." }),
  /** SMS opt-in checkbox next to the parent phone field (Lead Engine Stage 4).
   * Unchecked by default — wire name matches what the modal posts. Never
   * persisted on `event_signups` itself; see `CreateSignupDbInput` in
   * lib/db/event-signups.ts, which strips it the same way it strips
   * `waiver_accepted`. */
  sms_consent: z.boolean().optional().default(false),
})

export type CreateSignupInput = z.infer<typeof createEventSignupSchema>
