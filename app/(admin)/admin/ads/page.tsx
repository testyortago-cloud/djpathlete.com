import Link from "next/link"
import { Target, ShieldCheck, Construction, Settings, BarChart3, Sparkles } from "lucide-react"

export const metadata = { title: "Google Ads" }

interface PhaseRow {
  id: string
  title: string
  status: "shipped" | "in_progress" | "pending" | "blocked"
  description: string
  href?: string
}

const PHASES: PhaseRow[] = [
  {
    id: "1.5a",
    title: "Attribution capture & marketing consent",
    status: "shipped",
    description:
      "gclid / utm_* captured at landing into marketing_attribution; back-filled onto bookings, payments, newsletter signups, event signups. Marketing consent gate ready for Customer Match.",
    href: "/admin/ads/consent",
  },
  {
    id: "1.1",
    title: "OAuth + nightly campaign sync",
    status: "in_progress",
    description:
      "OAuth + sync orchestrator shipped. Nightly Cloud Function mirrors campaigns / ad_groups / keywords / ads / 7-day metrics / search terms into Supabase. Flips fully live the moment the Developer Token lands.",
    href: "/admin/ads/campaigns",
  },
  {
    id: "1.2",
    title: "AI recommendations engine",
    status: "in_progress",
    description:
      "Claude scores each campaign after the nightly sync and proposes negative keywords, bid changes, keyword pauses, ad variants. Approval queue is live; apply path lands with Plan 1.3.",
    href: "/admin/ads/recommendations",
  },
  {
    id: "1.3",
    title: "Apply path + automation modes",
    status: "in_progress",
    description:
      "Approve in the queue triggers a Google Ads mutation; auto-pilot auto-applies negative-keyword recs with confidence ≥ 0.8 (capped at 10/run). Every attempt writes an automation_log row with the request, response, and result.",
    href: "/admin/ads/automation-log",
  },
  {
    id: "1.4",
    title: "AI ad copy + weekly performance report",
    status: "pending",
    description: "Brand-voiced ad copy generation; Monday email digest of campaign performance.",
  },
  {
    id: "1.5b",
    title: "Customer Match audience sync",
    status: "pending",
    description:
      "Three hashed-email lists (ICP / Bookers / Subscribers) pushed daily to Google Ads as lookalike seeds and exclusion targeting layers.",
  },
  {
    id: "1.5c",
    title: "Booking conversion uploads",
    status: "pending",
    description:
      "Real-time offline conversion upload on booking creation, with gclid + admin-configurable initial value.",
  },
  {
    id: "1.5d",
    title: "Stripe value attribution",
    status: "pending",
    description:
      "When a booking turns into a paid Stripe charge, restate the conversion value to actual revenue so smart bidding learns true LTV.",
  },
  {
    id: "1.5e",
    title: "GA4 remarketing audience import",
    status: "pending",
    description: "Site visitors / blog readers / program-page viewers / abandoned-checkout — imported via the existing GA4 link.",
  },
  {
    id: "1.5f",
    title: "Pipeline dashboard + weekly funnel report",
    status: "pending",
    description: "Visit → newsletter → booking → payment funnel by campaign; cost-per-stage + revenue-per-stage views.",
  },
  {
    id: "1.5g",
    title: "AI Ads Agent",
    status: "pending",
    description:
      "Senior-marketer agent with three modes: weekly strategist (memo + queue), interactive co-pilot chat, per-campaign auto-apply. Drives the brand toward business_goals targets.",
  },
]

const STATUS_LABEL: Record<PhaseRow["status"], { label: string; classes: string }> = {
  shipped: { label: "Shipped", classes: "bg-success/10 text-success" },
  in_progress: { label: "In progress", classes: "bg-accent/15 text-accent" },
  pending: { label: "Pending", classes: "bg-muted/40 text-muted-foreground" },
  blocked: { label: "Blocked — Darren creds", classes: "bg-warning/15 text-warning" },
}

export default function AdsHomePage() {
  return (
    <div className="space-y-8">
      <div className="flex items-start gap-4">
        <div className="size-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Target className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-heading text-primary">Google Ads</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            AI-managed Google Ads with conversion feedback loops and a senior-marketer agent. The
            data foundation is live; the integration with Google Ads itself is queued behind your
            Developer Token approval.
          </p>
        </div>
      </div>

      {/* Working surfaces */}
      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Working today
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/admin/ads/consent"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
          >
            <div className="size-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <ShieldCheck className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-primary text-sm leading-snug">Marketing Consent Log</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Audit trail of every grant or revocation. Required evidence for Google Ads
                Customer Match opt-in compliance.
              </p>
            </div>
          </Link>

          <Link
            href="/admin/ads/campaigns"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
          >
            <div className="size-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <BarChart3 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-primary text-sm leading-snug">Campaigns</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Live mirror of your Google Ads campaigns with last-7-day spend / clicks /
                conversions. Manual "Sync now" button + nightly 06:00 UTC schedule.
              </p>
            </div>
          </Link>

          <Link
            href="/admin/ads/recommendations"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
          >
            <div className="size-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Sparkles className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-primary text-sm leading-snug">Recommendations</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                AI-generated optimizations sorted by confidence. Approve to queue for the apply
                path (Plan 1.3); reject to dismiss. Auto-generated after each nightly sync.
              </p>
            </div>
          </Link>

          <Link
            href="/admin/ads/settings"
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-accent/60"
          >
            <div className="size-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Settings className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-primary text-sm leading-snug">
                Google Ads — Connect
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                OAuth hand-off into your Google Ads account. Required before nightly sync, AI
                recommendations, and the AI Ads Agent come online.
              </p>
            </div>
          </Link>

          <div className="flex items-start gap-4 rounded-xl border border-dashed border-border/60 bg-surface/30 p-5">
            <div className="size-10 rounded-lg bg-muted/40 text-muted-foreground flex items-center justify-center shrink-0">
              <Construction className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading text-primary/70 text-sm leading-snug">
                Recommendations queue, AI ad copy, AI agent
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Coming with Plans 1.2 / 1.4 / 1.5g. Apply for the Google Ads Developer Token to
                unblock the live cutover.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Phase roadmap */}
      <section>
        <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
          ─ Roadmap
        </h2>
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3 w-16">Phase</th>
                <th className="text-left p-3">Deliverable</th>
                <th className="text-left p-3 w-44">Status</th>
              </tr>
            </thead>
            <tbody>
              {PHASES.map((phase) => {
                const status = STATUS_LABEL[phase.status]
                const titleNode = (
                  <div>
                    <p className="font-medium text-primary text-sm leading-snug">{phase.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{phase.description}</p>
                  </div>
                )
                return (
                  <tr key={phase.id} className="border-t border-border/60 align-top">
                    <td className="p-3 font-mono text-xs text-muted-foreground">{phase.id}</td>
                    <td className="p-3">
                      {phase.href ? (
                        <Link href={phase.href} className="block hover:text-accent transition-colors">
                          {titleNode}
                        </Link>
                      ) : (
                        titleNode
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${status.classes}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Specs: <code className="font-mono">docs/superpowers/specs/2026-05-02-google-ads-integration-design.md</code> ·{" "}
        <code className="font-mono">docs/superpowers/specs/2026-05-03-google-ads-leads-first-optimization-design.md</code>
      </p>
    </div>
  )
}
