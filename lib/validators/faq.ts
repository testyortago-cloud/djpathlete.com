import { z } from "zod"
import { resolveFaqPage } from "@/lib/faq/pages"

/** A page_key is valid if it resolves in the registry OR is an event key. */
function isKnownPageKey(key: string): boolean {
  if (key.startsWith("event/") && key.length > "event/".length) return true
  return resolveFaqPage(key) !== undefined
}

export const faqInputSchema = z
  .object({
    page_key: z.string().min(1).refine(isKnownPageKey, "Unknown page"),
    category: z.string().trim().min(1).nullable(),
    question: z.string().trim().min(1, "Question is required").max(300),
    answer: z.string().trim().min(1, "Answer is required").max(2000),
    link_text: z.string().trim().min(1).nullable(),
    link_href: z.string().trim().min(1).nullable(),
    status: z.enum(["published", "draft"]),
  })
  .refine((v) => (v.link_text === null) === (v.link_href === null), {
    message: "Link text and link URL must both be set or both be empty",
    path: ["link_text"],
  })

export type FaqInput = z.infer<typeof faqInputSchema>
