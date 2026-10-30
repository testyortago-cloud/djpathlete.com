"use client"

import { useState } from "react"
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DataTable,
  DataTableBadge,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"
import { STANDARD_TEST_TYPES, defaultStandard, standardOrderProblem } from "@/lib/coach-intel/test-normalization"
import { TEST_TYPE_DEFAULTS, TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { PerformanceStandard } from "@/lib/db/performance-standards"
import type { TestType } from "@/types/database"

/** One editable line: a saved row (id), or a draft (an unsaved age group, or the built-in all-ages numbers). */
interface Line {
  key: string
  id?: string
  test_type: TestType
  age_min: string
  age_max: string
  floor: string
  trained: string
  elite: string
}

const str = (n: number | null) => (n == null ? "" : String(Number(n.toFixed(2))))

function fromRow(r: PerformanceStandard): Line {
  return {
    key: r.id,
    id: r.id,
    test_type: r.test_type as TestType,
    age_min: str(r.age_min),
    age_max: str(r.age_max),
    floor: str(r.floor_value),
    trained: str(r.trained_value),
    elite: str(r.elite_value),
  }
}

/** The built-in numbers, as an unsaved all-ages line. */
function builtIn(t: TestType): Line {
  const d = defaultStandard(t)!
  return {
    key: `builtin-${t}`,
    test_type: t,
    age_min: "",
    age_max: "",
    floor: str(d.floor),
    trained: str(d.trained),
    elite: str(d.elite),
  }
}

function unitFor(t: TestType): string {
  return defaultStandard(t)?.relativeToBodyWeight ? "× body weight" : TEST_TYPE_DEFAULTS[t].unit
}

const isAllAges = (l: Line) => l.age_min === "" && l.age_max === ""
const num = (s: string) => (s.trim() === "" ? null : Number(s))

export function PerformanceStandardsEditor({ initial }: { initial: PerformanceStandard[] }) {
  const [lines, setLines] = useState<Line[]>(() => {
    const saved = initial.map(fromRow)
    const missing = STANDARD_TEST_TYPES.filter((t) => !saved.some((l) => l.test_type === t && isAllAges(l)))
    return [...saved, ...missing.map(builtIn)]
  })
  const [busy, setBusy] = useState<string | null>(null)

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function save(line: Line) {
    const [floor, trained, elite] = [num(line.floor), num(line.trained), num(line.elite)]
    if (floor == null || trained == null || elite == null || [floor, trained, elite].some(Number.isNaN)) {
      toast.error("Enter a starting point, a Trained and an Elite number.")
      return
    }
    const problem = standardOrderProblem(line.test_type, floor, trained, elite)
    if (problem) {
      toast.error(problem)
      return
    }
    setBusy(line.key)
    try {
      const res = await fetch("/api/admin/performance-standards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: line.id,
          test_type: line.test_type,
          age_min: num(line.age_min),
          age_max: num(line.age_max),
          floor_value: floor,
          trained_value: trained,
          elite_value: elite,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the standard")
        return
      }
      const saved = fromRow(data.standard as PerformanceStandard)
      setLines((ls) => ls.map((l) => (l.key === line.key ? saved : l)))
      toast.success(`${TEST_TYPE_LABELS[line.test_type]} saved`)
    } finally {
      setBusy(null)
    }
  }

  async function remove(line: Line) {
    if (!line.id) {
      setLines((ls) => ls.filter((l) => l.key !== line.key))
      return
    }
    setBusy(line.key)
    try {
      const res = await fetch(`/api/admin/performance-standards?id=${line.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error("Couldn't remove the standard")
        return
      }
      // An all-ages row goes back to the built-in numbers; an age group just goes.
      setLines((ls) =>
        isAllAges(line)
          ? ls.map((l) => (l.key === line.key ? builtIn(line.test_type) : l))
          : ls.filter((l) => l.key !== line.key),
      )
    } finally {
      setBusy(null)
    }
  }

  function addAgeGroup(t: TestType) {
    const base = lines.find((l) => l.test_type === t && isAllAges(l)) ?? builtIn(t)
    setLines((ls) => [...ls, { ...base, key: `new-${t}-${Date.now()}`, id: undefined, age_min: "", age_max: "" }])
  }

  const numberInput = (line: Line, field: "floor" | "trained" | "elite" | "age_min" | "age_max", label: string) => (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      aria-label={`${TEST_TYPE_LABELS[line.test_type]} ${label}`}
      value={line[field]}
      onChange={(e) => update(line.key, { [field]: e.target.value })}
      className="h-8 w-24"
    />
  )

  return (
    <DataTableCard>
      <DataTable>
        <DataTableHeader>
          <DataTableHead>Test</DataTableHead>
          <DataTableHead>Ages</DataTableHead>
          <DataTableHead>Starting point</DataTableHead>
          <DataTableHead>Trained</DataTableHead>
          <DataTableHead>Elite</DataTableHead>
          <DataTableHead align="right">Actions</DataTableHead>
        </DataTableHeader>
        <tbody>
          {STANDARD_TEST_TYPES.flatMap((t) => {
            const forTest = lines
              .filter((l) => l.test_type === t)
              .sort((a, b) => (isAllAges(a) ? -1 : isAllAges(b) ? 1 : (num(a.age_min) ?? 0) - (num(b.age_min) ?? 0)))
            return forTest.map((line, i) => (
              <DataTableRow key={line.key}>
                <DataTableCell className="align-top">
                  {i === 0 && (
                    <div>
                      <p className="font-medium text-foreground">{TEST_TYPE_LABELS[t]}</p>
                      <p className="text-xs text-muted-foreground">{unitFor(t)}</p>
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell>
                  {isAllAges(line) && line.id ? (
                    <span className="text-sm">All ages</span>
                  ) : isAllAges(line) && !line.key.startsWith("new-") ? (
                    <span className="flex items-center gap-2 text-sm">
                      All ages <DataTableBadge tone="neutral">Built-in</DataTableBadge>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm">
                      {numberInput(line, "age_min", "youngest age")}
                      <span className="text-muted-foreground">to</span>
                      {numberInput(line, "age_max", "oldest age")}
                    </span>
                  )}
                </DataTableCell>
                <DataTableCell>{numberInput(line, "floor", "starting point")}</DataTableCell>
                <DataTableCell>{numberInput(line, "trained", "Trained")}</DataTableCell>
                <DataTableCell>{numberInput(line, "elite", "Elite")}</DataTableCell>
                <DataTableCell align="right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button size="sm" onClick={() => save(line)} disabled={busy === line.key}>
                      {busy === line.key && <Loader2 className="size-3.5 animate-spin" />}
                      Save
                    </Button>
                    {isAllAges(line) && line.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(line)}
                        title="Back to the built-in numbers"
                      >
                        <RotateCcw className="size-3.5" />
                        Reset
                      </Button>
                    )}
                    {!isAllAges(line) || line.key.startsWith("new-") ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(line)}
                        aria-label="Remove this age group"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                    {i === 0 && (
                      <Button size="sm" variant="outline" onClick={() => addAgeGroup(t)}>
                        <Plus className="size-3.5" />
                        Age group
                      </Button>
                    )}
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))
          })}
        </tbody>
      </DataTable>
    </DataTableCard>
  )
}
