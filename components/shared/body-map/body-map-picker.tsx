"use client"

import { useState } from "react"
import type { BodyRegion, InjurySide } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"
import { BodyMapSVG, type BodyMapRegion } from "./body-map-svg"

export interface BodyMapValue {
  region: BodyRegion | null
  side: InjurySide
}

export function BodyMapPicker({ value, onChange }: { value: BodyMapValue; onChange: (v: BodyMapValue) => void }) {
  const [hover, setHover] = useState<BodyMapRegion | null>(null)
  const selected = value.region
  const selectedSide = value.side

  return (
    <div className="space-y-2">
      <div className="bg-card rounded-lg border p-2">
        <BodyMapSVG
          classForRegion={(r) =>
            r.region === selected && (r.side === selectedSide || selectedSide === "n_a") ? "!fill-primary" : ""
          }
          onClick={(r) => onChange({ region: r.region, side: r.side })}
          onHover={setHover}
        />
      </div>
      <p className="text-muted-foreground text-center text-sm">
        {selected
          ? `Selected: ${BODY_REGION_LABELS[selected]}${selectedSide !== "n_a" ? ` (${selectedSide})` : ""}`
          : hover
            ? `Hovering: ${BODY_REGION_LABELS[hover.region]}${hover.side !== "n_a" ? ` (${hover.side})` : ""}`
            : "Click a body region"}
      </p>
    </div>
  )
}
