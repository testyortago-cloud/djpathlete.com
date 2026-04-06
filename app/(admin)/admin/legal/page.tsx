import { requireAdmin } from "@/lib/auth-helpers"
import { getAllDocuments, getConsentCountsByDocument } from "@/lib/db/legal-documents"
import { PageHeader } from "@/components/shared/PageHeader"
import { LegalDocumentList } from "@/components/admin/LegalDocumentList"
import { Scale, FileCheck, Users, ShieldCheck } from "lucide-react"

export const dynamic = "force-dynamic"
export const metadata = { title: "Legal Documents | DJP Athlete Admin" }

export default async function AdminLegalPage() {
  await requireAdmin()

  const [documents, consentCounts] = await Promise.all([
    getAllDocuments(),
    getConsentCountsByDocument(),
  ])

  const activeDocuments = documents.filter((d) => d.is_active)
  const totalVersions = documents.length
  const totalConsents = Object.values(consentCounts).reduce((sum, c) => sum + c, 0)

  const stats = [
    {
      label: "Document Types",
      value: activeDocuments.length,
      icon: Scale,
      color: "bg-primary/10 text-primary",
    },
    {
      label: "Total Versions",
      value: totalVersions,
      icon: FileCheck,
      color: "bg-accent/10 text-accent",
    },
    {
      label: "Total Consents",
      value: totalConsents,
      icon: Users,
      color: "bg-success/10 text-success",
    },
    {
      label: "Active Documents",
      value: activeDocuments.length,
      icon: ShieldCheck,
      color: "bg-primary/10 text-primary",
    },
  ]

  return (
    <div>
      <PageHeader
        title="Legal Documents"
        description="Manage your Terms of Service, Privacy Policy, and Liability Waiver. Create new versions and track consent."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <LegalDocumentList documents={documents} consentCounts={consentCounts} />
    </div>
  )
}
