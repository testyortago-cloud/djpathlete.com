// The AI builder for a landing page. Same component as the funnels route; only
// the URL differs, so the sidebar can tell which tab you are in.
// See lib/funnels/admin-path.ts.

import { FunnelBuilderScreen } from "@/app/(admin)/admin/funnels/[id]/edit/[stepId]/page"

export default async function LandingPageEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; stepId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id, stepId } = await params
  const { start } = await searchParams
  return <FunnelBuilderScreen id={id} stepId={stepId} start={start} base="pages" />
}
