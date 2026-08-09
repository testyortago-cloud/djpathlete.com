import Link from "next/link"
import { notFound } from "next/navigation"
import { ExternalLink, Pencil } from "lucide-react"
import { getFunnelById, listSteps } from "@/lib/db/funnels"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { FunnelStatusControl } from "@/components/admin/funnels/FunnelStatusControl"

export const metadata = { title: "Funnel" }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FunnelDetailPage({ params }: PageProps) {
  const { id } = await params
  const funnel = await getFunnelById(id)
  if (!funnel) notFound()

  const steps = await listSteps(id)

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{funnel.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public URL:{" "}
            <a
              href={`/go/${funnel.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              /go/{funnel.slug}
            </a>
          </p>
        </div>
        <FunnelStatusControl funnelId={funnel.id} status={funnel.status} />
      </div>

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Page</DataTableHead>
            <DataTableHead className="hidden md:table-cell">Path</DataTableHead>
            <DataTableHead className="hidden md:table-cell">State</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <tbody>
            {steps.map((step) => (
              <DataTableRow key={step.id}>
                <DataTableCell>
                  <span className="font-medium text-primary">{step.name}</span>
                  {step.is_entry ? (
                    <span className="ml-2 text-xs text-muted-foreground">entry</span>
                  ) : null}
                </DataTableCell>
                <DataTableCell muted className="hidden md:table-cell text-xs">
                  /go/{funnel.slug}
                  {step.is_entry ? "" : `/${step.slug}`}
                </DataTableCell>
                <DataTableCell className="hidden md:table-cell">
                  <DataTableBadge tone={step.published_version_id ? "success" : "neutral"}>
                    {step.published_version_id ? "published" : "never published"}
                  </DataTableBadge>
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex items-center justify-end gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/funnels/${funnel.id}/edit/${step.id}`}>
                        <Pencil className="size-4" />
                        Edit
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={`/go/${funnel.slug}${step.is_entry ? "" : `/${step.slug}`}?preview=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        Preview
                      </a>
                    </Button>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </DataTable>
      </DataTableCard>
    </div>
  )
}
