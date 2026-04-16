"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export function SyncButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  return (
    <Button
      onClick={async () => {
        setLoading(true)
        try {
          const res = await fetch("/api/shop/sync", { method: "POST" })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? "Sync failed")
          toast.success(
            `Sync complete: ${data.added} added, ${data.updated} updated, ${data.deactivated_variants} variants deactivated`,
          )
          router.refresh()
        } catch (err) {
          toast.error((err as Error).message)
        } finally {
          setLoading(false)
        }
      }}
      disabled={loading}
    >
      <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Syncing…" : "Sync from Printful"}
    </Button>
  )
}
