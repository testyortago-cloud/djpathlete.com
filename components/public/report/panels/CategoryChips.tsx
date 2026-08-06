import { CATEGORY_ORDER } from "@/lib/test-report/scoring"
import type { RadarCategory } from "@/lib/coach-intel/test-normalization"

/** The reference's "seven angles" strip — DJP's five testing categories. */
export function CategoryChips({ active }: { active: RadarCategory[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {CATEGORY_ORDER.map((c) => {
        const isActive = active.includes(c)
        return (
          <span
            key={c}
            data-active={isActive ? "true" : "false"}
            className={`rounded-lg border px-3 py-2 text-center font-mono text-xs uppercase ${
              isActive ? "border-primary bg-card text-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {c}
          </span>
        )
      })}
    </div>
  )
}
