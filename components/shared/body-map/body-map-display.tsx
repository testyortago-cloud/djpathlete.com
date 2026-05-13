"use client"

import { useRouter } from "next/navigation"
import type { Injury, BodyRegion } from "@/types/database"
import { BodyMapSVG, type BodyMapRegion } from "./body-map-svg"

const STATUS_FILL: Record<Injury["status"], string> = {
  active: "!fill-error",
  recovering: "!fill-warning",
  resolved: "!fill-success/40",
}

export function BodyMapDisplay({
  injuries,
  clientUserId,
}: {
  injuries: Injury[]
  clientUserId?: string
}) {
  const router = useRouter()

  const byRegion = new Map<BodyRegion, Injury>()
  const priority: Record<Injury["status"], number> = {
    active: 3,
    recovering: 2,
    resolved: 1,
  }
  for (const i of injuries) {
    const existing = byRegion.get(i.body_region)
    if (!existing || priority[i.status] > priority[existing.status]) {
      byRegion.set(i.body_region, i)
    }
  }

  return (
    <BodyMapSVG
      classForRegion={(r: BodyMapRegion) => {
        const i = byRegion.get(r.region)
        if (!i) return ""
        if (i.side !== "n_a" && i.side !== "bilateral" && i.side !== r.side) return ""
        return STATUS_FILL[i.status]
      }}
      onClick={(r) => {
        const i = byRegion.get(r.region)
        if (i && clientUserId) {
          router.push(`/admin/clients/${clientUserId}/injuries/${i.id}`)
        } else if (i) {
          router.push(`/client/injuries/${i.id}`)
        }
      }}
    />
  )
}
