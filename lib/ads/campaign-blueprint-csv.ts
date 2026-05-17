// lib/ads/campaign-blueprint-csv.ts
// Renders a propose_new_campaign blueprint into a multi-section CSV that
// pastes cleanly into Google Ads Editor's "Make multiple changes" dialog.
// Each section maps to one entity type — open the file in Excel, copy a
// section, paste into the matching Editor panel.
//
// All campaigns are emitted as Status=Paused so nothing goes live by
// accident. Networks/Languages default to a sensible search-network
// baseline; budget = daily_budget_cents converted to dollars; keyword
// match types title-cased per Editor's vocabulary.
//
// Negatives are emitted at campaign scope with Match type=Broad (the
// standard "exclude anywhere the term appears" semantics the agent
// implicitly wants).

import type { CampaignBlueprintArgs } from "./agent/decision-schema"

const MATCH_TYPE_DISPLAY: Record<
  CampaignBlueprintArgs["keyword_themes"][number]["match_type"],
  string
> = {
  EXACT: "Exact",
  PHRASE: "Phrase",
  BROAD: "Broad",
}

const CAMPAIGN_TYPE_DISPLAY: Record<CampaignBlueprintArgs["campaign_type"], string> = {
  SEARCH: "Search",
  PMAX: "Performance Max",
  DISPLAY: "Display",
}

/** CSV-escape a single field. Wraps in quotes when it contains a quote, comma, or newline. */
function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function row(values: Array<string | number | null | undefined>): string {
  return values.map(escape).join(",")
}

export function renderCampaignBlueprintCsv(args: CampaignBlueprintArgs): string {
  const lines: string[] = []
  const budget = (args.daily_budget_cents / 100).toFixed(2)
  const campaignTypeDisplay = CAMPAIGN_TYPE_DISPLAY[args.campaign_type]
  const locations = args.geo_targets.join("; ")
  const campaignName = args.campaign_name

  // ── Campaign ───────────────────────────────────────────────────────
  lines.push(`# Campaign — paste into "Campaigns" panel`)
  lines.push(
    row([
      "Campaign",
      "Campaign type",
      "Status",
      "Budget",
      "Bid strategy type",
      "Networks",
      "Locations",
      "Languages",
    ]),
  )
  lines.push(
    row([
      campaignName,
      campaignTypeDisplay,
      "Paused",
      budget,
      "Manual CPC",
      "Google search",
      locations,
      "English",
    ]),
  )
  lines.push("")

  // ── Ad groups ──────────────────────────────────────────────────────
  lines.push(`# Ad groups — paste into "Ad groups" panel`)
  lines.push(row(["Campaign", "Ad group", "Status", "Default max. CPC"]))
  for (const theme of args.keyword_themes) {
    lines.push(row([campaignName, theme.theme, "Paused", "1.00"]))
  }
  lines.push("")

  // ── Keywords ───────────────────────────────────────────────────────
  lines.push(`# Keywords — paste into "Keywords" panel`)
  lines.push(row(["Campaign", "Ad group", "Keyword", "Match type", "Status"]))
  for (const theme of args.keyword_themes) {
    for (const kw of theme.keywords) {
      lines.push(
        row([campaignName, theme.theme, kw, MATCH_TYPE_DISPLAY[theme.match_type], "Paused"]),
      )
    }
  }
  lines.push("")

  // ── Responsive Search Ads ──────────────────────────────────────────
  // One RSA per ad group with all headlines + descriptions populated.
  const headlines = args.ad_copy.headlines
  const descriptions = args.ad_copy.descriptions
  const maxHeadlines = 15
  const maxDescriptions = 4
  const headlineCols = Array.from({ length: maxHeadlines }, (_, i) => `Headline ${i + 1}`)
  const descCols = Array.from({ length: maxDescriptions }, (_, i) => `Description ${i + 1}`)

  lines.push(`# Responsive search ads — paste into "Ads" panel`)
  lines.push(
    row([
      "Campaign",
      "Ad group",
      "Ad type",
      "Status",
      "Final URL",
      ...headlineCols,
      ...descCols,
    ]),
  )
  for (const theme of args.keyword_themes) {
    const headlineCells = Array.from({ length: maxHeadlines }, (_, i) => headlines[i] ?? "")
    const descCells = Array.from({ length: maxDescriptions }, (_, i) => descriptions[i] ?? "")
    lines.push(
      row([
        campaignName,
        theme.theme,
        "Responsive search ad",
        "Paused",
        args.ad_copy.final_url,
        ...headlineCells,
        ...descCells,
      ]),
    )
  }
  lines.push("")

  // ── Negative keywords (campaign scope) ─────────────────────────────
  lines.push(`# Campaign-negative keywords — paste into "Keywords > Negative" panel`)
  lines.push(row(["Campaign", "Keyword", "Match type"]))
  for (const neg of args.negative_seed) {
    lines.push(row([campaignName, neg, "Broad"]))
  }
  lines.push("")

  // ── Supporting evidence ────────────────────────────────────────────
  if (args.supporting_gaql_evidence.length > 0) {
    lines.push(`# Supporting evidence (informational only — not for Editor)`)
    lines.push(row(["GAQL", "Finding"]))
    for (const ev of args.supporting_gaql_evidence) {
      lines.push(row([ev.gaql, ev.finding]))
    }
    lines.push("")
  }

  return lines.join("\n")
}
