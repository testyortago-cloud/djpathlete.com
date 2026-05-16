import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAuditLogs } from "@/lib/db/audit-logs"
import type { AuditCategory, AuditOutcome } from "@/lib/audit/types"

const CATEGORIES = new Set<AuditCategory>([
  "auth","admin_write","admin_read_sensitive","client_action","support",
  "commerce","billing","marketing","compliance","automation","system",
])
const OUTCOMES = new Set<AuditOutcome>(["success","failure","denied"])

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(request.url)
  const p = url.searchParams

  const category = p.get("category")
  const outcome = p.get("outcome")
  const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1)
  const perPage = Math.min(200, Math.max(1, Number.parseInt(p.get("perPage") ?? "50", 10) || 50))

  const result = await listAuditLogs({
    category: category && CATEGORIES.has(category as AuditCategory) ? (category as AuditCategory) : undefined,
    action: p.get("action") || undefined,
    outcome: outcome && OUTCOMES.has(outcome as AuditOutcome) ? (outcome as AuditOutcome) : undefined,
    actor_id: p.get("actor_id") || undefined,
    target_type: p.get("target_type") || undefined,
    target_id: p.get("target_id") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    q: p.get("q") || undefined,
    page,
    perPage,
  })

  return NextResponse.json(result)
}
