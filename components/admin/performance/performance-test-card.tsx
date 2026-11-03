"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import { testDirection } from "@/lib/coach-intel/test-normalization"
import { SIDE_GAP_FLAG_PCT, sideGap } from "@/lib/coach-intel/test-cards"
import { formatDate, num } from "@/lib/test-report/format"
import type { PerformanceTest } from "@/types/database"

const historyHref = (clientUserId: string, t: PerformanceTest) =>
  `/admin/clients/${clientUserId}/performance/tests/${t.test_type}`

/** The whole card is the link to the test's history. */
function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Card className="h-full transition group-hover:border-primary/40 group-hover:shadow-md">{children}</Card>
    </Link>
  )
}

function Tags({ tests }: { tests: (PerformanceTest | undefined)[] }) {
  const fromOutput = tests.some((t) => t?.output_key)
  const pr = tests.some((t) => t?.is_pr)
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {fromOutput && (
        <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">
          Output
        </Badge>
      )}
      {pr && <Badge className="bg-accent">PR</Badge>}
    </span>
  )
}

/** "+4.2% vs prev", green when it is an improvement for this test (a faster sprint is a negative %). */
function Trend({ test }: { test: PerformanceTest }) {
  const pct = test.pct_change_from_prev
  if (pct === null || pct === undefined) return null
  const direction = test.test_type === "custom" ? null : testDirection(test.test_type)
  const better = direction === null || pct === 0 ? null : direction === "lower" ? pct < 0 : pct > 0
  const tone = better === null ? "text-muted-foreground" : better ? "text-success" : "text-error"
  return (
    <span className={tone}>
      {pct > 0 ? "+" : ""}
      {Number(pct).toFixed(1)}% vs prev
    </span>
  )
}

export function PerformanceTestCard({
  latest,
  history,
  clientUserId,
}: {
  latest: PerformanceTest
  /** Newest first. */
  history: PerformanceTest[]
  clientUserId: string
}) {
  const label = latest.test_type === "custom" ? (latest.custom_name ?? "Custom") : TEST_TYPE_LABELS[latest.test_type]
  const trendData = [...history].reverse().map((t) => ({ value: t.result_value }))
  return (
    <CardLink href={historyHref(clientUserId, latest)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base group-hover:text-primary">
          {label}
          <Tags tests={[latest]} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-bold">
          {num(latest.result_value)}{" "}
          <span className="text-muted-foreground text-sm font-normal">{latest.result_unit}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
          <span className="text-muted-foreground">{formatDate(latest.test_date)}</span>
          <Trend test={latest} />
        </p>
        {trendData.length > 1 && (
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </CardLink>
  )
}

function Side({ name, test }: { name: string; test: PerformanceTest | undefined }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{name}</p>
      {test ? (
        <>
          <p className="font-heading text-2xl font-bold">
            {num(test.result_value)}{" "}
            <span className="text-muted-foreground text-sm font-normal">{test.result_unit}</span>
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(test.test_date)}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Not tested yet</p>
      )}
    </div>
  )
}

/** A left/right test on one card: both sides' latest results and how far apart they are. */
export function PairedTestCard({
  label,
  left,
  right,
  clientUserId,
}: {
  label: string
  /** Each newest first; [] when that side was never tested. */
  left: PerformanceTest[]
  right: PerformanceTest[]
  clientUserId: string
}) {
  const [l, r] = [left[0], right[0]]
  const gap = sideGap(l, r)
  const flagged = !!gap?.weaker && gap.pct >= SIDE_GAP_FLAG_PCT
  return (
    <CardLink href={historyHref(clientUserId, (l ?? r) as PerformanceTest)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base group-hover:text-primary">
          {label}
          <Tags tests={[l, r]} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 divide-x divide-border">
          <Side name="Left" test={l} />
          <Side name="Right" test={r} />
        </div>
        <p
          className={`mt-3 flex items-center gap-1.5 border-t border-border pt-2 text-xs ${
            flagged ? "font-medium text-warning" : "text-muted-foreground"
          }`}
        >
          {flagged && <AlertTriangle className="size-3.5" />}
          {!l || !r
            ? "Test both sides to compare them"
            : !gap
              ? "Sides last tested on different days"
              : gap.weaker === null
                ? "Both sides level"
                : `${gap.weaker === "left" ? "Left" : "Right"} ${gap.pct}% behind ${gap.weaker === "left" ? "right" : "left"}`}
        </p>
      </CardContent>
    </CardLink>
  )
}
