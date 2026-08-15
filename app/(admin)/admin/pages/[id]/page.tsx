// A landing page's settings screen.
//
// Renders the SAME component as the funnels route — a landing page and a funnel
// are one row with a different `kind`, and two copies of this screen would be
// two things to keep in step. Only the URL differs, and that is the point: the
// admin sidebar highlights by path prefix, so a landing page has to live under
// `/admin/pages` or it lights up "Funnels".
//
// `base="pages"` is what stops the shared component redirecting in a circle:
// it redirects on a MISMATCH between the row's kind and the URL it arrived on,
// never on the kind alone. See lib/funnels/admin-path.ts.

import { FunnelDetailScreen } from "@/app/(admin)/admin/funnels/[id]/page"

export const metadata = { title: "Landing page" }

export default async function LandingPageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FunnelDetailScreen id={id} base="pages" />
}
