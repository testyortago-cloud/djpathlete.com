import { Download } from "lucide-react"
import { listLeadMagnets } from "@/lib/db/lead-magnets"
import { LeadMagnetList } from "@/components/admin/lead-magnets/LeadMagnetList"

export const metadata = { title: "Lead Magnets" }

export default async function LeadMagnetsPage() {
  const magnets = await listLeadMagnets(true)
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Lead Magnets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Downloadable assets that auto-render on tag-matched blog posts.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Download className="size-5 text-accent" />
        </div>
      </div>
      <LeadMagnetList initialMagnets={magnets} />
    </div>
  )
}
