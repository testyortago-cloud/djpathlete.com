import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { addDaysISO, shiftMonthISO, calendarRange, type ScheduleView } from "@/lib/schedule-calendar"

const VIEWS: ScheduleView[] = ["month", "week", "list"]
const VIEW_LABEL: Record<ScheduleView, string> = { month: "Month", week: "Week", list: "List" }

function href(view: ScheduleView, anchor: string): string {
  return `/admin/schedule?view=${view}&anchor=${anchor}`
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function rangeLabel(view: ScheduleView, anchor: string): string {
  if (view === "month") {
    return new Date(`${anchor}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
  }
  const { from, to } = calendarRange(view, anchor)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  const toLabel = sameMonth ? String(Number(to.slice(8))) : shortDate(to)
  return `${shortDate(from)} – ${toLabel}, ${to.slice(0, 4)}`
}

function shiftAnchor(view: ScheduleView, anchor: string, dir: 1 | -1): string {
  if (view === "month") return shiftMonthISO(anchor, dir)
  return addDaysISO(anchor, (view === "week" ? 7 : 14) * dir)
}

/** View toggle (Month / Week / List) + prev / Today / next navigation. */
export function ScheduleToolbar({ view, anchor, today }: { view: ScheduleView; anchor: string; today: string }) {
  const navLink =
    "inline-flex items-center justify-center rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground shadow-sm transition-colors hover:bg-muted"

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link href={href(view, shiftAnchor(view, anchor, -1))} aria-label="Previous" className={navLink}>
          <ChevronLeft className="size-4" />
        </Link>
        <Link href={href(view, today)} className={navLink}>
          Today
        </Link>
        <Link href={href(view, shiftAnchor(view, anchor, 1))} aria-label="Next" className={navLink}>
          <ChevronRight className="size-4" />
        </Link>
        <span className="ml-1 text-sm font-semibold text-foreground">{rangeLabel(view, anchor)}</span>
      </div>
      <div className="flex items-center rounded-lg border border-border bg-white p-0.5 shadow-sm">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={href(v, anchor)}
            aria-current={v === view ? "page" : undefined}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              v === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </div>
    </div>
  )
}
