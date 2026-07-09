import { z } from "zod"

export const parsedSheetSchema = z.object({
  sheets: z
    .array(
      z.object({
        name: z.string(),
        rows: z.array(z.array(z.string())),
      }),
    )
    .min(1),
})

export type ParsedSheetInput = z.infer<typeof parsedSheetSchema>

export const programImportOptionsSchema = z.object({
  client_id: z
    .string()
    .uuid("Invalid client ID")
    .nullish()
    .transform((v) => v ?? null),
  is_public: z.coerce.boolean().default(false),
  name_override: z
    .string()
    .max(200)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  notify_email: z
    .string()
    .email()
    .nullish()
    .transform((v) => v ?? null),
})

export type ProgramImportOptions = z.infer<typeof programImportOptionsSchema>
