"use client"

import { useState } from "react"
import Link from "next/link"
import { Printer, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ReportInjuryForm } from "@/components/client/performance/report-injury-form"
import { LogTrainingSessionForm } from "@/components/client/coach-intel/log-training-session-form"
import { LogTestDialog } from "@/components/client/performance/log-test-dialog"

export function PerformanceActionButtons({
  clientUserId,
  reportUrl,
}: {
  clientUserId: string
  /** Public test-report URL; null when the client isn't eligible for one. */
  reportUrl?: string | null
}) {
  const [injuryOpen, setInjuryOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={injuryOpen} onOpenChange={setInjuryOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            + Report injury
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Report injury</DialogTitle>
          </DialogHeader>
          <ReportInjuryForm clientUserId={clientUserId} onSuccess={() => setInjuryOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            + Log session
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log training session</DialogTitle>
          </DialogHeader>
          <LogTrainingSessionForm clientUserId={clientUserId} onSuccess={() => setSessionOpen(false)} />
        </DialogContent>
      </Dialog>

      <LogTestDialog
        clientUserId={clientUserId}
        trigger={<Button size="sm">+ Log test</Button>}
      />

      {/* The client-facing test report. Lives in the header, not just the Tests
          tab, so it is reachable from every tab rather than only after the coach
          knows to look under Tests. */}
      {reportUrl && (
        <Button variant="outline" size="sm" asChild>
          <Link href={reportUrl} target="_blank" rel="noopener noreferrer">
            <FileText className="size-4" />
            Test report
          </Link>
        </Button>
      )}

      <Button variant="outline" size="sm" asChild>
        <Link href={`/admin/clients/${clientUserId}/performance/print`} target="_blank">
          <Printer className="size-4" />
          Print result page
        </Link>
      </Button>
    </div>
  )
}
