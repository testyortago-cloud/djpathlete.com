import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/permissions/guard"
import { getNewsletterById } from "@/lib/db/newsletters"
import { NewsletterForm } from "@/components/admin/newsletter/NewsletterForm"
import type { Newsletter } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: "Edit Newsletter" }

export default async function EditNewsletterPage({ params }: Props) {
  await requirePermission("blog")
  const { id } = await params

  let newsletter: Newsletter
  try {
    newsletter = (await getNewsletterById(id)) as Newsletter
  } catch {
    notFound()
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">
        {newsletter.status === "sent" ? "View Newsletter" : "Edit Newsletter"}
      </h1>
      <NewsletterForm newsletter={newsletter} authorId={newsletter.author_id} />
    </div>
  )
}
