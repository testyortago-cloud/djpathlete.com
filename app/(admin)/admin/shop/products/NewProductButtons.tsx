"use client"

import { useState } from "react"
import { NewDigitalProductDialog } from "@/components/admin/shop/products/dialogs/NewDigitalProductDialog"
import { NewAffiliateProductDialog } from "@/components/admin/shop/products/dialogs/NewAffiliateProductDialog"

export function NewProductButtons() {
  const [digitalOpen, setDigitalOpen] = useState(false)
  const [affiliateOpen, setAffiliateOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setDigitalOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 font-body text-sm hover:bg-muted"
      >
        + Digital
      </button>
      <button
        type="button"
        onClick={() => setAffiliateOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 font-body text-sm hover:bg-muted"
      >
        + Affiliate
      </button>
      <NewDigitalProductDialog open={digitalOpen} onOpenChange={setDigitalOpen} />
      <NewAffiliateProductDialog open={affiliateOpen} onOpenChange={setAffiliateOpen} />
    </>
  )
}
