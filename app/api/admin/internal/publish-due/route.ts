// app/api/admin/internal/publish-due/route.ts
// Cron endpoint hit by Vercel Cron every 5 minutes. Guarded by a shared
// bearer token (INTERNAL_CRON_TOKEN env var). Bootstraps the plugin registry
// with real push + email senders (TikTok hybrid), then delegates the actual
// publishing loop to runScheduledPublish().

import { NextRequest, NextResponse } from "next/server"
import { runScheduledPublish } from "@/lib/social/publish-runner"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { getAdminApp } from "@/lib/firebase-admin"
import { getMessaging } from "firebase-admin/messaging"
import { Resend } from "resend"
import type { PlatformConnection } from "@/types/database"

function getAuthedCoachEmail(): string {
  return process.env.COACH_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? ""
}

function getResendClient(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error("RESEND_API_KEY is not configured")
  return new Resend(key)
}

async function bootstrapWithRealSenders(connections: PlatformConnection[]) {
  const coachEmail = getAuthedCoachEmail()
  const resend = getResendClient()
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@djpathlete.com"

  bootstrapPlugins(connections, {
    tiktokEmail: coachEmail,
    tiktokFcmToken: null,
    async sendPush({ token, title, body, data }) {
      if (!token) return
      await getMessaging(getAdminApp()).send({
        token,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      })
    },
    async sendEmail({ to, subject, html }) {
      await resend.emails.send({ from: fromEmail, to, subject, html })
    },
  })
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expected = `Bearer ${process.env.INTERNAL_CRON_TOKEN ?? ""}`
  if (!process.env.INTERNAL_CRON_TOKEN || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runScheduledPublish({
      bootstrap: async (conns) => {
        await bootstrapWithRealSenders(conns as PlatformConnection[])
      },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[publish-due] Error:", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "Unknown publish-due error" },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
