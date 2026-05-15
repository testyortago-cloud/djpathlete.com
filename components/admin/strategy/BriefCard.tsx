import type { StrategyBrief } from "@/types/database"
import { StatusPill } from "./StatusPill"

export function BriefCard({ brief }: { brief: StrategyBrief }) {
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-primary">Week of {brief.week_of}</h3>
          <StatusPill status={brief.approval_status} />
        </div>
        <p className="text-sm text-muted-foreground mt-1">{brief.audience_focus}</p>
        <p className="text-xs text-muted-foreground mt-2">
          <span className="font-medium text-primary">Priority:</span> {brief.priority_channel}
          {brief.themes.length > 0 && (
            <>
              <span className="mx-2">·</span>
              <span className="font-medium text-primary">Themes:</span>{" "}
              {brief.themes.map((t) => t.tag).join(", ")}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
