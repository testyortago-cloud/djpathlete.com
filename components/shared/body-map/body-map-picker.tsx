"use client"

import Model, { type IExerciseData, type IMuscleStats, type Muscle } from "react-body-highlighter"
import type { BodyRegion, InjurySide } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"
import { cn } from "@/lib/utils"

export interface BodyMapValue {
  region: BodyRegion | null
  side: InjurySide
}

const REGION_TO_MUSCLES: Partial<Record<BodyRegion, { anterior?: Muscle[]; posterior?: Muscle[] }>> = {
  head: { anterior: ["head"], posterior: ["head"] },
  neck: { anterior: ["neck"], posterior: ["neck"] },
  chest: { anterior: ["chest"] },
  shoulder: { anterior: ["front-deltoids"], posterior: ["back-deltoids"] },
  upper_back: { posterior: ["trapezius", "upper-back"] },
  lower_back: { posterior: ["lower-back"] },
  glute: { posterior: ["gluteal"] },
  quad: { anterior: ["quadriceps"] },
  hamstring: { posterior: ["hamstring"] },
  knee: { anterior: ["knees"], posterior: ["knees"] },
  calf: { posterior: ["calves"] },
}

const MUSCLE_TO_REGION: Partial<Record<Muscle, BodyRegion>> = {
  head: "head",
  neck: "neck",
  chest: "chest",
  "front-deltoids": "shoulder",
  "back-deltoids": "shoulder",
  trapezius: "upper_back",
  "upper-back": "upper_back",
  "lower-back": "lower_back",
  gluteal: "glute",
  quadriceps: "quad",
  hamstring: "hamstring",
  knees: "knee",
  calves: "calf",
}

const JOINT_REGIONS: BodyRegion[] = ["elbow", "wrist", "hand", "hip", "ankle", "foot", "other"]

const NO_SIDE_REGIONS: BodyRegion[] = ["head", "neck", "chest", "upper_back", "lower_back", "other"]

const SIDES: { label: string; value: InjurySide }[] = [
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
  { label: "Bilateral", value: "bilateral" },
  { label: "N/A", value: "n_a" },
]

const BODY_COLOR = "#e5e7eb"
const SELECTED_COLOR = "#0E3F50"

function nextSideFor(region: BodyRegion, currentSide: InjurySide): InjurySide {
  if (NO_SIDE_REGIONS.includes(region)) return "n_a"
  return currentSide === "n_a" ? "left" : currentSide
}

export function BodyMapPicker({ value, onChange }: { value: BodyMapValue; onChange: (v: BodyMapValue) => void }) {
  const buildSelectionData = (view: "anterior" | "posterior"): IExerciseData[] => {
    if (!value.region) return []
    const map = REGION_TO_MUSCLES[value.region]
    if (!map) return []
    const muscles = view === "anterior" ? map.anterior : map.posterior
    if (!muscles?.length) return []
    return [{ name: "Selected", muscles, frequency: 1 }]
  }

  const onMuscleClick = (stats: IMuscleStats) => {
    const region = MUSCLE_TO_REGION[stats.muscle]
    if (!region) return
    onChange({ region, side: nextSideFor(region, value.side) })
  }

  const showSideSelector = value.region && !NO_SIDE_REGIONS.includes(value.region)

  return (
    <div className="space-y-3">
      <div className="border-border space-y-4 rounded-xl border bg-white p-4 shadow-sm">
        {/* Anatomical model */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col items-center gap-2">
            <span className="font-heading text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.2em]">
              Front
            </span>
            <Model
              type="anterior"
              data={buildSelectionData("anterior")}
              bodyColor={BODY_COLOR}
              highlightedColors={[SELECTED_COLOR]}
              onClick={onMuscleClick}
              style={{ width: "100%", maxWidth: 180 }}
            />
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="font-heading text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.2em]">
              Back
            </span>
            <Model
              type="posterior"
              data={buildSelectionData("posterior")}
              bodyColor={BODY_COLOR}
              highlightedColors={[SELECTED_COLOR]}
              onClick={onMuscleClick}
              style={{ width: "100%", maxWidth: 180 }}
            />
          </div>
        </div>

        {/* Joint / extremity chips */}
        <div className="border-border border-t pt-3">
          <p className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wider">
            Joints &amp; extremities
          </p>
          <div className="flex flex-wrap gap-1.5">
            {JOINT_REGIONS.map((r) => {
              const isSelected = value.region === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => onChange({ region: r, side: nextSideFor(r, value.side) })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground bg-white hover:bg-surface",
                  )}
                >
                  {BODY_REGION_LABELS[r]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Side selector */}
        {showSideSelector && (
          <div className="border-border border-t pt-3">
            <p className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wider">Side</p>
            <div className="grid grid-cols-4 gap-1.5">
              {SIDES.map((s) => {
                const isSelected = value.side === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => value.region && onChange({ region: value.region, side: s.value })}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground bg-white hover:bg-surface",
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-center text-sm">
        {value.region ? (
          <>
            Selected: <span className="text-foreground font-medium">{BODY_REGION_LABELS[value.region]}</span>
            {value.side !== "n_a" && !NO_SIDE_REGIONS.includes(value.region) ? ` (${value.side})` : ""}
          </>
        ) : (
          "Click a body region to begin"
        )}
      </p>
    </div>
  )
}
