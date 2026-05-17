"use client"

import { useState } from "react"
import { Copy, Download, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { CampaignBlueprintArgs } from "@/lib/ads/agent/decision-schema"

interface Props {
  recId: string
  trigger: React.ReactNode
}

interface ApiResponse {
  blueprint: CampaignBlueprintArgs
  reasoning: string
}

const MATCH_TYPE_DISPLAY: Record<
  CampaignBlueprintArgs["keyword_themes"][number]["match_type"],
  string
> = { EXACT: "Exact", PHRASE: "Phrase", BROAD: "Broad" }

const CONVERSION_GOAL_DISPLAY: Record<CampaignBlueprintArgs["conversion_goal"], string> = {
  form_submission_lead: "Capture leads (form submissions)",
  purchase: "Drive a purchase",
  booking: "Book a session",
}

const CAMPAIGN_TYPE_DISPLAY: Record<CampaignBlueprintArgs["campaign_type"], string> = {
  SEARCH: "Search",
  PMAX: "Performance Max",
  DISPLAY: "Display",
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${label}`)
  } catch {
    toast.error("Couldn't copy — please select and copy manually.")
  }
}

export function BlueprintModal({ recId, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (data || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ads/recommendations/${recId}/blueprint`)
      const json = (await res.json()) as ApiResponse | { error: string }
      if (!res.ok || "error" in json) {
        throw new Error(("error" in json && json.error) || `HTTP ${res.status}`)
      }
      setData(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) load()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div onClick={() => handleOpenChange(true)} className="contents">
        {trigger}
      </div>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Campaign preview</DialogTitle>
          <DialogDescription>
            A ready-to-paste plan for Google Ads. Copy each section into the corresponding
            screen, or download the whole thing for Google Ads Editor.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            Loading preview…
          </div>
        ) : error ? (
          <div className="border border-error/40 bg-error/5 text-error rounded-md p-4 text-sm">
            Couldn&apos;t load the preview: {error}
          </div>
        ) : data ? (
          <BlueprintBody data={data} recId={recId} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BlueprintBody({ data, recId }: { data: ApiResponse; recId: string }) {
  const b = data.blueprint
  const budget = (b.daily_budget_cents / 100).toFixed(2)
  const allKeywordsText = b.keyword_themes
    .map((t) => `# ${t.theme} (${MATCH_TYPE_DISPLAY[t.match_type]})\n${t.keywords.join("\n")}`)
    .join("\n\n")

  return (
    <div className="space-y-5">
      {/* Why this campaign */}
      <Section title="Why this campaign">
        <p className="text-sm text-primary leading-relaxed">{data.reasoning}</p>
      </Section>

      {/* Campaign basics */}
      <Section title="Campaign basics" onCopy={() => copyToClipboard(
        `Name: ${b.campaign_name}\nType: ${CAMPAIGN_TYPE_DISPLAY[b.campaign_type]}\nDaily budget: $${budget}\nGoal: ${CONVERSION_GOAL_DISPLAY[b.conversion_goal]}\nLocations: ${b.geo_targets.join(", ")}\nFinal URL: ${b.ad_copy.final_url}`,
        "campaign basics",
      )}>
        <DefList rows={[
          ["Name", b.campaign_name],
          ["Type", CAMPAIGN_TYPE_DISPLAY[b.campaign_type]],
          ["Daily budget", `$${budget}/day`],
          ["Goal", CONVERSION_GOAL_DISPLAY[b.conversion_goal]],
          ["Locations", b.geo_targets.join(", ")],
          ["Final URL", b.ad_copy.final_url],
        ]} />
      </Section>

      {/* Keywords — grouped by theme */}
      <Section title="Keywords (grouped by ad group)" onCopy={() => copyToClipboard(allKeywordsText, "all keywords")}>
        <div className="space-y-3">
          {b.keyword_themes.map((theme, i) => (
            <div key={i} className="border border-border/60 rounded-md p-3 bg-surface/40">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-primary">
                  {theme.theme}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({MATCH_TYPE_DISPLAY[theme.match_type]})
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(theme.keywords.join("\n"), `${theme.theme} keywords`)}
                  className="text-xs text-muted-foreground hover:text-accent flex items-center gap-1"
                >
                  <Copy className="size-3" /> Copy keywords
                </button>
              </div>
              <ul className="text-sm font-mono space-y-0.5 text-primary">
                {theme.keywords.map((k, j) => <li key={j}>{k}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Ad copy */}
      <Section title="Ad copy" onCopy={() => copyToClipboard(
        `HEADLINES (<=30 chars each)\n${b.ad_copy.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\nDESCRIPTIONS (<=90 chars each)\n${b.ad_copy.descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\nFinal URL: ${b.ad_copy.final_url}`,
        "ad copy",
      )}>
        <div className="space-y-3">
          <CopyableList
            label={`Headlines · ${b.ad_copy.headlines.length} (max 30 chars each)`}
            items={b.ad_copy.headlines}
          />
          <CopyableList
            label={`Descriptions · ${b.ad_copy.descriptions.length} (max 90 chars each)`}
            items={b.ad_copy.descriptions}
          />
        </div>
      </Section>

      {/* Negatives */}
      {b.negative_seed.length > 0 ? (
        <Section title="Negative keywords (block these searches)" onCopy={() => copyToClipboard(b.negative_seed.join("\n"), "negatives")}>
          <ul className="text-sm font-mono space-y-0.5 text-primary">
            {b.negative_seed.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </Section>
      ) : null}

      {/* Evidence */}
      {b.supporting_gaql_evidence.length > 0 ? (
        <Section title="Why these keywords">
          <div className="space-y-2">
            {b.supporting_gaql_evidence.map((e, i) => (
              <div key={i} className="text-sm text-primary">
                {e.finding}
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Footer download link */}
      <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
        <a
          href={`/api/admin/ads/recommendations/${recId}/blueprint.csv`}
          className="text-xs text-muted-foreground hover:text-accent inline-flex items-center gap-1.5"
        >
          <Download className="size-3.5" /> Download for Google Ads Editor (CSV)
        </a>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  onCopy,
}: {
  title: string
  children: React.ReactNode
  onCopy?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        {onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            className="text-xs text-muted-foreground hover:text-accent flex items-center gap-1"
          >
            <Copy className="size-3" /> Copy section
          </button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function DefList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function CopyableList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="border border-border/60 rounded-md p-3 bg-surface/40">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-primary">{label}</p>
        <button
          type="button"
          onClick={() => copyToClipboard(items.join("\n"), label.split(" · ")[0].toLowerCase())}
          className="text-xs text-muted-foreground hover:text-accent flex items-center gap-1"
        >
          <Copy className="size-3" /> Copy
        </button>
      </div>
      <ul className="text-sm space-y-0.5 text-primary">
        {items.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className="text-[10px] text-muted-foreground font-mono w-4 text-right">
              {i + 1}.
            </span>
            <span>{s}</span>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {s.length}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
