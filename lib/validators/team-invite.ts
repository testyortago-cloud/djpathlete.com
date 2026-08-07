import { z } from "zod"
import { invalidPermissionKeys, sanitizePermissionMap, PRESETS } from "@/lib/permissions/registry"
import type { PermissionMap } from "@/lib/permissions/registry"

const PRESET_KEYS = PRESETS.map((p) => p.key) as [string, ...string[]]

/**
 * A permission map that must already be legal.
 *
 * Deliberately rejects rather than sanitizes: a permission that is silently
 * dropped looks identical to a granted one in the UI, which is how someone
 * ends up believing a teammate has access they do not have.
 */
export const permissionMapSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const key of invalidPermissionKeys(value)) {
      ctx.addIssue({
        code: "custom",
        message: `"${key}" is not a permission that can be granted`,
        path: [key],
      })
    }
  })
  .transform((value): PermissionMap => sanitizePermissionMap(value))

export const sendInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address"),
  role: z.enum(["editor", "staff"]),
  /** Which preset the checkboxes started from. Display only. */
  staffRole: z.enum(PRESET_KEYS).optional(),
  permissions: permissionMapSchema.optional().default({}),
})

export type SendInviteInput = z.infer<typeof sendInviteSchema>

export const updateMemberPermissionsSchema = z.object({
  staffRole: z.enum(PRESET_KEYS).optional(),
  permissions: permissionMapSchema,
})

export type UpdateMemberPermissionsInput = z.infer<typeof updateMemberPermissionsSchema>

export const assignClientsSchema = z.object({
  clientIds: z.array(z.string().uuid()).max(500),
})

export const claimInviteSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(120, "Password is too long"),
})

export type ClaimInviteInput = z.infer<typeof claimInviteSchema>
