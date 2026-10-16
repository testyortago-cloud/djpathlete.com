import type { NewsletterResults } from "@/lib/db/newsletter-deliveries"
import { resultTiles } from "@/lib/newsletter/results"

interface NewsletterResultsPanelProps {
  results: NewsletterResults | undefined
  /** People the retry has not sent to yet (waiting or awaiting Resend's answer). */
  stillResending: number
}

/** What happened to a sent newsletter's emails. Server-rendered; no state. */
export function NewsletterResultsPanel({ results, stillResending }: NewsletterResultsPanelProps) {
  return (
    <section className="rounded-xl border border-border bg-white shadow-sm p-4 sm:p-5 mb-6">
      <h2 className="text-base font-semibold text-primary mb-3">Results</h2>
      {results && results.recipients > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {resultTiles(results).map((t) => (
              <div key={t.label} className="rounded-lg border border-border bg-surface/30 p-3">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-xl font-semibold text-primary">{t.value}</p>
                {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
              </div>
            ))}
          </div>
          {stillResending > 0 && (
            <p className="text-sm text-primary mt-3">
              {stillResending.toLocaleString("en-US")} more are still being resent.
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Results keep coming in for a few days after a send. Opens are approximate: some mail apps open every email
            automatically.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No results recorded for this send.</p>
      )}
    </section>
  )
}
