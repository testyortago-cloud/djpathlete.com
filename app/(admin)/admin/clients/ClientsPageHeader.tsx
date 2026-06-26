"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AddClientDialog } from "@/components/admin/AddClientDialog"
import { SelfCheckinQrDialog } from "@/components/admin/packs/SelfCheckinQrDialog"

export function ClientsPageHeader({
  qrDataUrl,
  checkinUrl,
}: {
  qrDataUrl: string | null
  checkinUrl: string | null
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-semibold text-primary">Clients</h1>
      <div className="flex items-center gap-2">
        {qrDataUrl && checkinUrl && <SelfCheckinQrDialog qrDataUrl={qrDataUrl} checkinUrl={checkinUrl} />}
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="size-4 mr-1.5" />
          Add Client
        </Button>
      </div>
      <AddClientDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
