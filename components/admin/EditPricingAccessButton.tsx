"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PricingAccessSheet } from "@/components/admin/PricingAccessSheet"
import type { Program } from "@/types/database"

export function EditPricingAccessButton({ program }: { program: Program }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DollarSign className="size-4" />
        Pricing &amp; access
      </Button>
      <PricingAccessSheet
        open={open}
        onOpenChange={setOpen}
        program={program}
        onPublished={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
