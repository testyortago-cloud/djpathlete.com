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
          These are the behind-the-scenes tasks that keep Content Studio running — pulling your latest stats, sending
          your reports, and helping the AI stay on-brand. Pause everything with one click, or run any task right now.
        </p>
      </div>

      <PauseToggle initialPaused={paused} />

      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Clock className="size-4 text-primary" />
          <h2 className="text-lg font-semibold text-primary">Automated tasks</h2>
        </div>

        <div className="divide-y divide-border">
          {CRON_CATALOG.map((job) => (
            <div key={job.name} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 p-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-primary">{job.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{job.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  <span className="font-medium text-primary">When it runs:</span> {job.humanSchedule}
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
          <li>Each task runs automatically on its own schedule — you don&apos;t need to do anything.</li>
          <li>
            The <span className="font-medium text-primary">Pause</span> switch at the top stops every task instantly.
            Useful when you&apos;re on vacation, running maintenance, or just want emails to stop for a while.
            Remember to hit Resume when you&apos;re ready again.
          </li>
          <li>
            <span className="font-medium text-primary">Run now</span> triggers a task immediately instead of waiting
            for its next scheduled time — handy when you want fresh numbers or an email sent right away.
          </li>
        </ul>
      </div>
    </div>
  )
}
