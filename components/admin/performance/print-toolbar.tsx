"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Printer, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Screen-only toolbar for the athlete result page. Auto-opens the browser print
 * dialog shortly after mount (so the coach lands straight on Save-as-PDF) and
 * offers manual re-print + back. Hidden in the printed output.
 */
export function PrintToolbar() {
  const router = useRouter()

  useEffect(() => {
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="print-hide mb-6 flex items-center justify-between gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="size-4" /> Back
      </Button>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-4" /> Print / Save as PDF
      </Button>
    </div>
  )
}
