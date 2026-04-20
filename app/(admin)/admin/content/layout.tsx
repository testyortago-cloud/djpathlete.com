import { notFound } from "next/navigation"
import { isContentStudioEnabled } from "@/lib/content-studio/feature-flag"
import { ContentStudioShell } from "@/components/admin/content-studio/ContentStudioShell"

export default function ContentStudioLayout({ children }: { children: React.ReactNode }) {
  if (!isContentStudioEnabled()) {
    notFound()
  }
  return <ContentStudioShell>{children}</ContentStudioShell>
}
