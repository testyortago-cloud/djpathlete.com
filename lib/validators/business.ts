import { z } from "zod"
import { permissionMapSchema } from "@/lib/validators/team-invite"

/**
 * Slugs that would collide with a route segment or with a reserved word in
 * this app. Checked BEFORE the regex has a chance to pass them: 'admin' and
 * 'api' are both perfectly legal against the pattern.
 */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "www", "go", "preview", "funnel-preview",
  "client", "editor", "login", "register", "book", "b", "primary",
])

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

/**
 * A timezone is free text that reaches `toLocaleString` several layers away,
 * where an invalid IANA zone throws RangeError -- the exact fault phase 0's
 * timezone wrapper exists to contain. Validate it here, at the edge, by asking
 * Intl whether it accepts the zone.
 */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const businessCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the business a name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "The web address needs at least two characters")
    .max(63)
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and hyphens, starting with a letter or number")
    .refine((s) => !RESERVED_SLUGS.has(s), "That web address is reserved — pick another"),
  timezone: z
    .string()
    .trim()
    .min(1, "Pick a timezone")
    .refine(isValidTimezone, "That is not a timezone this app recognises"),
  hostDisplayName: z.string().trim().min(1, "Who takes the calls?").max(120),
  // '' is allowed, exactly as business_settings and booking_hosts both allow.
  hostEmail: z.union([z.literal(""), z.string().trim().email("That is not an email address")]),
})

export type BusinessCreateInput = z.infer<typeof businessCreateSchema>

/** Every business_settings column an operator may edit. All optional — a patch. */
export const businessSettingsPatchSchema = z.object({
  display_name: z.string().trim().max(200).optional(),
  sender_name: z.string().trim().max(200).optional(),
  sender_email: z.union([z.literal(""), z.string().trim().email()]).optional(),
  reply_to: z.union([z.literal(""), z.string().trim().email()]).optional(),
  logo_url: z.union([z.literal(""), z.string().trim().url()]).nullable().optional(),
  timezone: z.string().trim().min(1).refine(isValidTimezone, "Unrecognised timezone").optional(),
  quiet_hours_start: z.number().int().min(0).max(23).optional(),
  quiet_hours_end: z.number().int().min(0).max(23).optional(),
  daily_message_cap: z.number().int().min(1).max(50).optional(),
  postal_address: z.string().trim().max(500).optional(),
  sms_help_text: z.string().trim().max(500).optional(),
  sms_messaging_service_sid: z.string().trim().max(64).optional(),
  // NOT normalised to E.164 here -- getBusinessBySmsNumber (lib/db/businesses.ts)
  // matches this verbatim against Twilio's `To` field, which IS always E.164.
  // Dormant today (no admin route writes this field yet); whoever builds that
  // form must normalise to E.164 before it reaches here, or a coach who types
  // a national-format number silently breaks inbound-SMS tenant resolution.
  sms_sender_phone: z.string().trim().max(32).optional(),
})

export type BusinessSettingsPatch = z.infer<typeof businessSettingsPatchSchema>

export const businessPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "paused"]).optional(),
})

export type BusinessPatch = z.infer<typeof businessPatchSchema>

/**
 * POST /api/admin/businesses/[id]/members. No `role` field for the same
 * reason sendInviteSchema has none -- the PLATFORM role (staff | editor) is
 * derived server-side from `permissions`. `businessRole` is a different axis
 * entirely: it is what business_members.role the accept path grants, per
 * migration 00240's (owner|coach|staff) check.
 */
export const businessMemberInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  businessRole: z.enum(["owner", "coach", "staff"]),
  permissions: permissionMapSchema.optional().default({}),
})

export type BusinessMemberInviteInput = z.infer<typeof businessMemberInviteSchema>

export const businessMemberRemoveSchema = z.object({
  userId: z.string().uuid(),
})

export type BusinessMemberRemoveInput = z.infer<typeof businessMemberRemoveSchema>
