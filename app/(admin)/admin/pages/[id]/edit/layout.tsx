// The landing-page builder's shell. Same component as the funnels route; only
// the URL differs, so the sidebar can tell which tab you are in.
// See lib/funnels/admin-path.ts.
//
// A landing page is single-page by definition, so `StepRail` renders nothing
// here and the editor looks exactly as it did before this feature. The shell
// is still mounted because it also owns the `ConnectionsProvider`, which is
// what lets the inspector's destination picker know there are no other pages
// to offer.

import { FunnelBuilderShell } from "@/app/(admin)/admin/funnels/[id]/edit/layout"

export default async function LandingPageEditLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = await params
  return <FunnelBuilderShell id={id}>{children}</FunnelBuilderShell>
}
