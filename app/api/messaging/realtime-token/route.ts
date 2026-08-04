// GET /api/messaging/realtime-token
// Mints the short-lived Supabase JWT the browser hands to realtime.setAuth().
// Without it auth.uid() is NULL in the browser and every RLS policy denies.
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { signRealtimeToken } from "@/lib/messaging/realtime-token"

export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // A missing secret is a deployment gap, not a client error. Saying so plainly
  // lets the dock render "live updates unavailable" and fall back to polling,
  // instead of a silent socket that never delivers.
  if (!process.env.SUPABASE_JWT_SECRET) {
    return NextResponse.json({ error: "Realtime is not configured" }, { status: 503 })
  }

  const { token, expiresAt } = await signRealtimeToken(session.user.id)
  return NextResponse.json({ token, expiresAt })
}
