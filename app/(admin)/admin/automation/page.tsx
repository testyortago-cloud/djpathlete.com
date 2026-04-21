import { Clock } from "lucide-react"
import { getSetting } from "@/lib/db/system-settings"
import { CRON_CATALOG } from "@/lib/cron-catalog"
import { PauseToggle } from "@/components/admin/automation/PauseToggle"
import { RunNowButton } from "@/components/admin/automation/RunNowButton"

export const metadata = { title: "Automation" }

export default async function AutomationPage() {
  const paused = await getSetting<boolean>("automation_paused", false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Automation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The scheduled jobs that keep Content Studio running. Pause them all with one click or run any of them on
          demand.
        </p>
      </div>

      <PauseToggle initialPaused={paused} />

      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Clock className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Scheduled jobs</h2>
        </div>

        <div className="divide-y divide-border">
          {CRON_CATALOG.map((job) => (
            <div key={job.name} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-medium text-primary">{job.label}</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1.5 py-0.5 rounded bg-muted/40">
                    {job.phase}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{job.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  <span className="font-medium text-primary">{job.humanSchedule}</span>
                  {" · "}
                  <span className="font-mono text-[11px]">{job.schedule}</span>
                  {" · "}
                  <span className="text-[11px]">{job.timezone}</span>
                </p>
              </div>
              <div className="shrink-0">
                <RunNowButton jobName={job.name} label={job.label} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-primary">How this works</p>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>
            Each scheduled job runs on its own cadence. The pause switch above stops every job without needing a
            redeploy.
          </li>
          <li>
            &quot;Run now&quot; triggers the same code the cron would run — useful for testing a change or pulling fresh
            numbers between scheduled windows.
          </li>
          <li>
            Edit schedules in <code className="font-mono text-xs">functions/src/index.ts</code> and redeploy.
          </li>
        </ul>
      </div>
    </div>
  )
}
