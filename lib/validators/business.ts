import { z } from "zod"
import { isUsableTimezone } from "@/lib/timezones"
import { normalisePhone } from "@/lib/lead-engine/identity"
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

// A timezone is free text that reaches `toLocaleString` several layers away,
// where an invalid IANA zone throws RangeError. Validated here, at the edge:
// an operator picking their own business timezone is CHOOSING, so a wrong one
// is worth rejecting the payload over. (A lead's browser-reported zone is a
// different question with a different answer — see lib/db/contacts.ts.)
const isValidTimezone = isUsableTimezone

export const SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE =
  "Start with + and the country code, exactly as Twilio shows the number (for example +1 202 555 0123)."
export const SMS_SENDER_PHONE_NOT_A_NUMBER =
  "That is not a phone number. Copy it from Twilio, starting with + and the country code."

// Checked BEFORE libphonenumber sees the value. It reads a number out of
// surrounding text and drops an extension without a word, so
// "+1 202 555 0123 ext. 5" would otherwise save as +12025550123. A "+" is
// allowed once, at the start.
//
// The digits are the four sets libphonenumber reads (ASCII, fullwidth,
// Arabic-Indic, Persian), so a coach on a Japanese or Arabic keyboard is not
// told a correct number is "not a phone number"; the saved value is ASCII
// E.164 either way. The FULLWIDTH PLUS (U+FF0B) is refused on purpose:
// libphonenumber does not read it as "international" and falls back to
// normalisePhone's US default, so "＋65 8123 4567" (Singapore) would save as
// +16581234567, a Jamaican number.
const PHONE_CHARACTERS = /^\+?[0-9０-９٠-٩۰-۹\s().-]+$/

// Saved in E.164 because it is compared VERBATIM with the `To` Twilio posts on
// every inbound text (getBusinessBySmsNumber in lib/db/businesses.ts), and
// Twilio always posts E.164. It is also the `From` of every outbound text when
// the business has no Messaging Service. BusinessSettingsForm writes it.
//
// The country code is REQUIRED, not assumed. Read with a default country of
// US, a Mexico City number typed as "55 1234 5678" is a VALID US number,
// +15512345678, so a white-label coach outside the US would have their number
// filed under +1 with nothing said.
//
// Idempotent on E.164, which it has to be: the form parses with this schema
// through zodResolver and submits the transformed value, and the route parses
// the body again.
const smsSenderPhoneSchema = z
  .string()
  .trim()
  .max(32)
  .transform((raw, ctx) => {
    // '' is "not configured" -- the column is NOT NULL DEFAULT '' (00221).
    if (raw === "") return ""
    if (!PHONE_CHARACTERS.test(raw)) {
      ctx.addIssue({ code: "custom", message: SMS_SENDER_PHONE_NOT_A_NUMBER })
      return z.NEVER
    }
    if (!raw.startsWith("+")) {
      ctx.addIssue({ code: "custom", message: SMS_SENDER_PHONE_NEEDS_COUNTRY_CODE })
      return z.NEVER
    }
    // The value starts with "+", so normalisePhone's default country is never
    // consulted.
    const e164 = normalisePhone(raw)
    if (!e164) {
      ctx.addIssue({ code: "custom", message: SMS_SENDER_PHONE_NOT_A_NUMBER })
      return z.NEVER
    }
    return e164
  })

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
  sms_sender_phone: smsSenderPhoneSchema.optional(),
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
