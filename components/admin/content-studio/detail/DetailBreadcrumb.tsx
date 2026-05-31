import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

interface DetailBreadcrumbProps {
  /** Href of the parent tab the user came from (e.g. /admin/content?tab=videos). */
  backHref: string
  /** Label of that parent tab (Videos / Posts / Calendar / Pipeline). */
  backLabel: string
  /** The current page (video title or "Manual post"); rendered as the trail's tail. */
  current: string
}

// Content Studio › {tab} › {current}. The "Pipeline" tab IS /admin/content, so we
// drop it to avoid a redundant "Content Studio › Pipeline" hop.
export function DetailBreadcrumb({ backHref, backLabel, current }: DetailBreadcrumbProps) {
  const showParent = backLabel !== "Pipeline"

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/admin/content">Content Studio</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {showParent && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={backHref}>{backLabel}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </>
        )}
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="max-w-[40ch] truncate">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
