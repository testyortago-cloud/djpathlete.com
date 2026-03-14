import Link from "next/link"
import { Mail, Send, Clock, Users } from "lucide-react"
import { getNewsletters } from "@/lib/db/newsletters"
import { getActiveSubscribers } from "@/lib/db/newsletter"
import { NewsletterList } from "@/components/admin/newsletter/NewsletterList"
import type { Newsletter } from "@/types/database"

export const metadata = { title: "Newsletter" }

export default async function NewsletterPage() {
  const [newsletters, subscribers] = await Promise.all([
    getNewsletters() as Promise<Newsletter[]>,
    getActiveSubscribers(),
  ])

  const total = newsletters.length
  const sent = newsletters.filter((n) => n.status === "sent").length
  const drafts = newsletters.filter((n) => n.status === "draft").length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Newsletter</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Mail className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Total
            </p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">
              {total}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <Send className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Sent
            </p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">
              {sent}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Clock className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Drafts
            </p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">
              {drafts}
            </p>
          </div>
        </div>

        <Link
          href="/admin/newsletter/subscribers"
          className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 hover:border-primary/30 hover:shadow-sm transition-all group"
        >
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-accent/20">
            <Users className="size-3.5 sm:size-4 text-accent-foreground" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Subscribers
            </p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">
              {subscribers.length}
            </p>
          </div>
          <span className="ml-auto text-xs text-muted-foreground group-hover:text-primary transition-colors hidden sm:inline">
            View all &rarr;
          </span>
        </Link>
      </div>

      <NewsletterList newsletters={newsletters} />
    </div>
  )
}
