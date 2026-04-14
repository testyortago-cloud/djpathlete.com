import { ArrowLeft, Users } from "lucide-react"
import Link from "next/link"
import { getAllSubscribers } from "@/lib/db/newsletter"
import { SubscriberList } from "@/components/admin/newsletter/SubscriberList"

export const metadata = { title: "Subscribers" }

export default async function SubscribersPage() {
  const subscribers = await getAllSubscribers()

  const active = subscribers.filter((s) => !s.unsubscribed_at).length
  const unsubscribed = subscribers.filter((s) => s.unsubscribed_at).length

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/newsletter"
          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold text-primary">Subscribers</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="size-3.5 sm:size-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Total</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{subscribers.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <Users className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Active</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{active}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
            <Users className="size-3.5 sm:size-4 text-warning" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Unsubscribed</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{unsubscribed}</p>
          </div>
        </div>
      </div>

      <SubscriberList subscribers={subscribers} />
    </div>
  )
}
