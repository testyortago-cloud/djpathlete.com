import { InsightsClient } from "@/components/admin/bookkeeping/InsightsClient"
import { coerceHomeOfficePercent } from "@/lib/bookkeeping/insight-types"
import { listBooks } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"

export const metadata = { title: "Insights — Books — Admin" }

export default async function InsightsPage() {
  const [books, storedPercent] = await Promise.all([
    listBooks(),
    getSetting<number | null>("bookkeeping_home_office_percent", null),
  ])
  return <InsightsClient books={books} initialHomeOfficePercent={coerceHomeOfficePercent(storedPercent)} />
}
