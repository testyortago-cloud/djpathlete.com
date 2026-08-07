// POST /api/admin/integrations/gsc/disconnect
// Admin-only. Deletes the (single) gsc_properties row. After this, the
// nightly sync route returns { skipped: "not_connected" }.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getGscProperty, deleteGscProperty } from "@/lib/db/gsc-properties"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export const POST = withAudit(
  {
    action: "integration.disconnected",
    category: "admin_write",
    target: { type: "integration", id: "gsc", label: "gsc" },
  },
  async () => {
    const session = await auth()
    if (!session?.user || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const row = await getGscProperty()
    if (!row) return NextResponse.json({ ok: true, alreadyDisconnected: true })
    await deleteGscProperty(row.id)
    return NextResponse.json({ ok: true })
  },
)
