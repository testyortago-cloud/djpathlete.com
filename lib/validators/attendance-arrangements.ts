import { z } from "zod"

/** Free text is CLAMPED, never rejected on length. A `.max()` here would throw
 *  away the whole request because a coach typed a long note — the presentation
 *  limit belongs after the parse, not as a gate in front of it. */
const clampedText = (limit: number) =>
  z
    .string()
    .trim()
    .transform((s) => s.slice(0, limit))

export const startArrangementSchema = z.object({
  clientUserId: z.string().uuid(),
  /** Who bills this client, e.g. the facility's name. */
  label: clampedText(120).optional(),
  sessionType: clampedText(60).optional(),
  notes: clampedText(1000).optional(),
})

export const endArrangementSchema = z.object({
  arrangementId: z.string().uuid(),
})

export type StartArrangementInput = z.infer<typeof startArrangementSchema>
