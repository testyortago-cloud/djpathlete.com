"use client"

import { useRouter } from "next/navigation"
import Model, { type IExerciseData, type IMuscleStats, type Muscle } from "react-body-highlighter"
import type { Injury, BodyRegion } from "@/types/database"
import { BODY_REGION_LABELS } from "@/lib/validators/injury"

type Status = Injury["status"]

const STATUS_PRIORITY: Record<Status, number> = {
  resolved: 1,
  recovering: 2,
  active: 3,
}

// highlightedColors[frequency - 1] — so index 0 = resolved, 1 = recovering, 2 = active
const STATUS_COLORS = ["#86efac", "#fbbf24", "#ef4444"]
const BODY_COLOR = "#e5e7eb"

const LEGEND: { label: string; status: Status; dot: string }[] = [
  { label: "Active", status: "active", dot: "bg-error" },
  { label: "Recovering", status: "recovering", dot: "bg-warning" },
  { label: "Resolved", status: "resolved", dot: "bg-success/60" },
]

// BodyRegion → muscle names supported by react-body-highlighter, per view.
// Regions absent from this map are surfaced as chips below the figures.
const REGION_TO_MUSCLES: Partial<Record<BodyRegion, { anterior?: Muscle[]; posterior?: Muscle[] }>> = {
  head: { anterior: ["head"], posterior: ["head"] },
  neck: { anterior: ["neck"], posterior: ["neck"] },
  chest: { anterior: ["chest"] },
  shoulder: { anterior: ["front-deltoids"], posterior: ["back-deltoids"] },
  upper_back: { posterior: ["trapezius", "upper-back"] },
  lower_back: { posterior: ["lower-back"] },
  hip: { posterior: ["gluteal"] },
  glute: { posterior: ["gluteal"] },
  quad: { anterior: ["quadriceps"] },
  hamstring: { posterior: ["hamstring"] },
  knee: { anterior: ["knees"], posterior: ["knees"] },
  calf: { posterior: ["calves"] },
}

const UNMAPPED_REGIONS: BodyRegion[] = ["elbow", "wrist", "hand", "ankle", "foot"]

function buildModelData(
  injuries: Injury[],
  view: "anterior" | "posterior",
): { data: IExerciseData[]; byMuscle: Map<Muscle, Injury> } {
  // Aggregate by muscle, keeping the highest-priority status per muscle
  const muscleStatus = new Map<Muscle, Status>()
  const byMuscle = new Map<Muscle, Injury>()

  for (const inj of injuries) {
    const map = REGION_TO_MUSCLES[inj.body_region]
    if (!map) continue
    const muscles = view === "anterior" ? map.anterior : map.posterior
    if (!muscles) continue
    for (const m of muscles) {
      const cur = muscleStatus.get(m)
      if (!cur || STATUS_PRIORITY[inj.status] > STATUS_PRIORITY[cur]) {
        muscleStatus.set(m, inj.status)
        byMuscle.set(m, inj)
      }
    }
  }

  // Build one data entry per status bucket; library uses frequency to index highlightedColors
  const buckets: Record<Status, Muscle[]> = { resolved: [], recovering: [], active: [] }
  for (const [muscle, status] of muscleStatus) {
    buckets[status].push(muscle)
  }
  const data: IExerciseData[] = []
  if (buckets.resolved.length)
    data.push({ name: "Resolved", muscles: buckets.resolved, frequency: STATUS_PRIORITY.resolved })
  if (buckets.recovering.length)
    data.push({ name: "Recovering", muscles: buckets.recovering, frequency: STATUS_PRIORITY.recovering })
  if (buckets.active.length)
    data.push({ name: "Active", muscles: buckets.active, frequency: STATUS_PRIORITY.active })

  return { data, byMuscle }
}

export function BodyMapDisplay({ injuries, clientUserId }: { injuries: Injury[]; clientUserId?: string }) {
  const router = useRouter()

  const front = buildModelData(injuries, "anterior")
  const back = buildModelData(injuries, "posterior")

  const counts = LEGEND.map((entry) => ({
    ...entry,
    count: injuries.filter((i) => i.status === entry.status).length,
  }))

  const unmappedInjuries = injuries.filter((i) => UNMAPPED_REGIONS.includes(i.body_region))

  function routeTo(injury: Injury) {
    if (clientUserId) {
      router.push(`/admin/clients/${clientUserId}/injuries/${injury.id}`)
    } else {
      router.push(`/client/injuries/${injury.id}`)
    }
  }

  function handleMuscleClick(view: "anterior" | "posterior") {
    const byMuscle = view === "anterior" ? front.byMuscle : back.byMuscle
    return (stats: IMuscleStats) => {
      const injury = byMuscle.get(stats.muscle)
      if (injury) routeTo(injury)
    }
  }

  const statusChipClass: Record<Status, string> = {
    active: "bg-error/10 text-error border-error/20",
    recovering: "bg-warning/15 text-warning border-warning/20",
    resolved: "bg-success/15 text-success border-success/20",
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm">
      {/* Header + legend */}
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h3 className="font-heading text-primary text-base font-semibold">Body Map</h3>
          <p className="text-muted-foreground text-xs">Click a highlighted region to open the injury</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {counts.map((entry) => (
            <div key={entry.status} className="flex items-center gap-1.5">
              <span className={`inline-block size-2.5 rounded-full ${entry.dot}`} />
              <span className="text-muted-foreground">{entry.label}</span>
              <span className="text-foreground font-medium tabular-nums">{entry.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Anatomical figures */}
      <div className="px-4 py-6 sm:px-6">
        <div className="grid grid-cols-2 gap-4 sm:gap-8">
          <div className="flex flex-col items-center gap-3">
            <span className="font-heading text-primary text-[11px] font-semibold uppercase tracking-[0.18em]">
              Front
            </span>
            <Model
              type="anterior"
              data={front.data}
              bodyColor={BODY_COLOR}
              highlightedColors={STATUS_COLORS}
              onClick={handleMuscleClick("anterior")}
              style={{ width: "100%", maxWidth: 220 }}
            />
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className="font-heading text-primary text-[11px] font-semibold uppercase tracking-[0.18em]">
              Back
            </span>
            <Model
              type="posterior"
              data={back.data}
              bodyColor={BODY_COLOR}
              highlightedColors={STATUS_COLORS}
              onClick={handleMuscleClick("posterior")}
              style={{ width: "100%", maxWidth: 220 }}
            />
          </div>
        </div>

        {/* Joints/extremities not covered by the anatomical model — surface as clickable chips */}
        {unmappedInjuries.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
              Other affected areas
            </p>
            <div className="flex flex-wrap gap-2">
              {unmappedInjuries.map((inj) => (
                <button
                  key={inj.id}
                  type="button"
                  onClick={() => routeTo(inj)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 ${statusChipClass[inj.status]}`}
                >
                  <span className="capitalize">
                    {BODY_REGION_LABELS[inj.body_region]}
                    {inj.side !== "n_a" && inj.side !== "bilateral" ? ` (${inj.side})` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
