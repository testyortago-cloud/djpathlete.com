import { z } from "zod"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const folderNameSchema = z.object({ name: z.string().trim().min(1).max(80) })

export const saveToLibrarySchema = z.object({
  folder_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
})

export const moveToFolderSchema = z.object({ folder_id: z.string().uuid() })

export const giveProgramSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  start_date: z.string().regex(DATE_RE),
  release_weekly: z.boolean(),
  weeks_visible_at_start: z.number().int().min(1).max(104),
  complimentary: z.boolean().default(false),
})
