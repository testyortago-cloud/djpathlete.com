"use client"

import Link from "next/link"
import { Gauge, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AthleteProfileLinkDialog } from "@/components/admin/profile-share/AthleteProfileLinkDialog"

export interface ReportShare {
  qrDataUrl: string
  profileUrl: string
  reportPhotoUrl: string | null
  testCount: number
}

/**
 * The athlete's showcase pages, next to the results they are built from: the Arena card,
 * the share link for the test report, and the Trained & Elite standards both are judged by.
 * They used to sit on the client page, away from the performance data.
 */
export function AthleteProfileBar({
  clientUserId,
  clientName,
  share,
}: {
  clientUserId: string
  clientName: string
  /** null when the client is not eligible for a public report (not an active client). */
  share: ReportShare | null
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white p-3 shadow-sm">
      <span className="mr-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Athlete profile
      </span>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/admin/clients/${clientUserId}/arena`}>
          <LayoutDashboard className="size-4" />
          Arena card
        </Link>
      </Button>
      {share && (
        <AthleteProfileLinkDialog
          qrDataUrl={share.qrDataUrl}
          profileUrl={share.profileUrl}
          clientName={clientName}
          testCount={share.testCount}
          clientUserId={clientUserId}
          reportPhotoUrl={share.reportPhotoUrl}
        />
      )}
      <Button variant="outline" size="sm" asChild>
        <Link href="/admin/settings/performance-standards">
          <Gauge className="size-4" />
          Trained &amp; Elite standards
        </Link>
      </Button>
    </div>
  )
}
