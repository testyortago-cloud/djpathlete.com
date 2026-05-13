// POST /api/admin/integrations/gsc/disconnect
// Admin-only. Deletes the (single) gsc_properties row. After this, the
// nightly sync route returns { skipped: "not_connected" }.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getGscProperty, deleteGscProperty } from "@/lib/db/gsc-properties"

export async function POST() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const row = await getGscProperty()
  if (!row) return NextResponse.json({ ok: true, alreadyDisconnected: true })
  await deleteGscProperty(row.id)
  return NextResponse.json({ ok: true })
}
