import { requireAdmin } from "@/lib/auth-helpers"
import { NewsletterForm } from "@/components/admin/newsletter/NewsletterForm"

export const metadata = { title: "New Newsletter" }

export default async function NewNewsletterPage() {
  const session = await requireAdmin()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">New Newsletter</h1>
      <NewsletterForm authorId={session.user!.id!} />
    </div>
  )
}
