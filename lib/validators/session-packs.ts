import { z } from "zod"

export const packProductSchema = z.object({
  name: z.string().min(1),
  sessionType: z.string().min(1),
  credits: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  validityDays: z.number().int().positive().nullable().optional(),
  stripePriceId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const adhocPackSchema = z.object({
  sessionType: z.string().min(1),
  credits: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  validityDays: z.number().int().positive().nullable().optional(),
})

export const sellPackSchema = z
  .object({
    clientUserId: z.string().uuid(),
    productId: z.string().uuid().optional(),
    adhoc: adhocPackSchema.optional(),
    paymentMethod: z.enum(["stripe", "cash", "comp"]),
    /** Cash sales only: the pack is handed out now but payment (Venmo etc.) hasn't arrived yet. */
    owed: z.boolean().optional(),
    programId: z.string().uuid().optional(),
    returnUrl: z.string().optional(),
    notes: z.string().optional(),
    /** Address the Stripe link to someone else (e.g. a parent with no account). */
    billToEmail: z.string().email().optional(),
    /** Consent checkbox: save the payer's card and auto-buy a replacement pack on depletion. */
    autoRenew: z.boolean().optional().default(false),
  })
  .refine((d) => !!d.productId || !!d.adhoc, { message: "Provide productId or adhoc pack" })

export const checkinSchema = z.object({
  clientUserId: z.string().uuid(),
  token: z.string().min(1),
  method: z.enum(["qr_self", "coach_tap", "manual"]).optional(),
})

export const voidCheckinSchema = z.object({
  checkinId: z.string().uuid(),
  reason: z.string().optional(),
})

/** Client-portal self check-in: only the token; identity comes from the session. */
export const selfCheckinSchema = z.object({ token: z.string().min(1) })

/** Client self-purchase: only the product; identity comes from the session. */
export const selfCheckoutSchema = z.object({
  productId: z.string().uuid(),
  /** Consent checkbox: save the client's card and auto-buy a replacement pack on depletion. */
  autoRenew: z.boolean().optional().default(false),
})

/** Admin partial update of a catalogue product. */
export const packProductUpdateSchema = packProductSchema.partial()

export type SellPackInput = z.infer<typeof sellPackSchema>
export type PackProductInput = z.infer<typeof packProductSchema>
export type AdhocPackInput = z.infer<typeof adhocPackSchema>
export type CheckinInput = z.infer<typeof checkinSchema>
