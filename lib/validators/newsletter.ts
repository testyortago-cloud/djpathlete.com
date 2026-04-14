import { z } from "zod"

export const newsletterFormSchema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters").max(200, "Subject must be under 200 characters"),
  preview_text: z.string().max(300, "Preview text must be under 300 characters").default(""),
  content: z.string().min(10, "Content must be at least 10 characters"),
})
