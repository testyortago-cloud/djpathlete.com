import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/permissions/guard"
import { getNewsletterById } from "@/lib/db/newsletters"
import { NewsletterForm } from "@/components/admin/newsletter/NewsletterForm"
import { NewsletterResultsPanel } from "@/components/admin/newsletter/NewsletterResultsPanel"
import {
  getNewsletterResults,
  getNewsletterRetrySummaries,
  type NewsletterResults,
  type NewsletterRetrySummary,
} from "@/lib/db/newsletter-deliveries"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { ShareToLinkedInButton } from "@/components/admin/social/ShareToLinkedInButton"
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

  // Under the platform's business, the one the writers file rows under (see
  // the JOB BUSINESS entry in lib/tenancy/platform.ts). Extra, so a failed
  // read (e.g. before migration 00292 runs) shows no results instead of a 500.
  let results: NewsletterResults | undefined
  let stillResending = 0
  if (newsletter.status === "sent") {
    const [all, retries] = await Promise.all([
      getNewsletterResults(platformBusinessId()).catch(() => ({}) as Record<string, NewsletterResults>),
      getNewsletterRetrySummaries(platformBusinessId()).catch(() => ({}) as Record<string, NewsletterRetrySummary>),
    ])
    results = all[newsletter.id]
    const retry = retries[newsletter.id]
    stillResending = retry ? retry.pending + retry.sending : 0
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-primary">
          {newsletter.status === "sent" ? "View Newsletter" : "Edit Newsletter"}
        </h1>
        {(newsletter.status === "sent" || newsletter.status === "scheduled") && (
          <ShareToLinkedInButton source={{ newsletterId: newsletter.id }} variant="full" />
        )}
      </div>
      <NewsletterForm
        newsletter={newsletter}
        authorId={newsletter.author_id}
        results={
          newsletter.status === "sent" ? (
            <NewsletterResultsPanel results={results} stillResending={stillResending} />
          ) : undefined
        }
      />
    </div>
  )
}
