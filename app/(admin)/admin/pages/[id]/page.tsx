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

import { redirect } from "next/navigation"
import { getFunnelById } from "@/lib/db/funnels"
import { FunnelDetailScreen } from "@/app/(admin)/admin/funnels/[id]/page"

export const metadata = { title: "Landing page" }

export default async function LandingPageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const funnel = await getFunnelById(id)

  // A LANDING PAGE HAS NO DETAIL SCREEN. The shared screen is a step list, and
  // a landing page is one step by definition, so this URL rendered a single
  // card repeating the one `/admin/pages` already shows. Its controls — go
  // live, public URL, delete — all moved onto that card, so
  // the list IS the screen and this address is only ever somewhere to pass
  // through: an old bookmark, an open tab, a link written before the split.
  //
  // Kind-checked, not unconditional. A FUNNEL reached on this URL still needs
  // the mismatch redirect the shared screen owns (`/admin/funnels/<id>`), and a
  // row that does not exist still needs its notFound() — restating either here
  // is how the two would drift apart.
  if (funnel?.kind === "page") redirect("/admin/pages")

  return <FunnelDetailScreen id={id} base="pages" />
}
