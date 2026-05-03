// app/api/admin/internal/auto-blog/route.ts
// Internal cron endpoint hit twice a week (Tuesday + Thursday) by GitHub Actions.
// Picks the highest-ranked unused topic suggestion and queues a blog_generation job.
//
// Two safety gates: (1) global automation_paused, (2) per-job
// cron_auto_blog_enabled. Both must be passable for the cron to fire — the
// global pause stops everything, the per-job toggle is the on/off the coach
// flips from /admin/automation. Default for cron_auto_blog_enabled is FALSE,
// so this is opt-in.

import { NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { createServiceRoleClient } from "@/lib/supabase"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { getSetting, isAutomationPaused } from "@/lib/db/system-settings"
import { proposePrimaryKeyword } from "@/lib/blog/keyword-proposal"
import { extractContentAngle } from "@/lib/blog/content-angle"
import type { ContentCalendarEntry } from "@/types/database"

interface TopicMetadata {
  rank?: number
  tavily_url?: string
  summary?: string
  source?: string
}

const SYSTEM_USER_ID = "__cron__"

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // ── Gate 1: global pause ──────────────────────────────────────────────
    if (await isAutomationPaused()) {
      console.log("[auto-blog] skipped — automation_paused is true")
      return NextResponse.json({ skipped: "automation_paused" }, { status: 200 })
    }

    // ── Gate 2: per-job toggle (default false; opt-in) ────────────────────
    const enabled = await getSetting<boolean>("cron_auto_blog_enabled", false)
    if (!enabled) {
      console.log("[auto-blog] skipped — cron_auto_blog_enabled is false")
      return NextResponse.json({ skipped: "cron_auto_blog_enabled" }, { status: 200 })
    }

    // ── Pick the best unused topic suggestion ─────────────────────────────
    const supabase = createServiceRoleClient()
    const { data: rows, error } = await supabase
      .from("content_calendar")
      .select("*")
      .eq("entry_type", "topic_suggestion")
      .eq("status", "planned")
      .order("scheduled_for", { ascending: false })
      .limit(50)
    if (error) {
      console.error("[auto-blog] fetch suggestions failed:", error.message)
      return NextResponse.json({ error: "Failed to load topic suggestions" }, { status: 500 })
    }

    const candidates = (rows ?? []) as ContentCalendarEntry[]
    if (candidates.length === 0) {
      console.log("[auto-blog] skipped — no unused topic suggestions")
      return NextResponse.json({ skipped: "no_topics" }, { status: 200 })
    }

    // Best = the most recent week's #1 ranked topic. If multiple recent weeks
    // tied on scheduled_for, pick lowest rank (rank 1 = best).
    const best = pickBestTopic(candidates)
    if (!best) {
      console.log("[auto-blog] skipped — no rankable topic found")
      return NextResponse.json({ skipped: "no_rankable_topic" }, { status: 200 })
    }

    const meta = (best.metadata ?? {}) as TopicMetadata
    const promptLines = [best.title, meta.summary].filter(Boolean).join("\n\n")
    const referenceUrls = meta.tavily_url ? [meta.tavily_url] : []

    // ── Run keyword + angle proposals in parallel ─────────────────────────
    const [proposedKeyword, contentAngle] = await Promise.all([
      proposePrimaryKeyword({ title: best.title, summary: meta.summary }),
      extractContentAngle({ title: best.title, summary: meta.summary }),
    ])
    console.log(
      `[auto-blog] picked topic id=${best.id} rank=${meta.rank ?? "?"} title="${best.title.slice(0, 60)}..." keyword="${proposedKeyword}" angle=${contentAngle ? "yes" : "no"}`,
    )

    // ── Queue the blog_generation job ─────────────────────────────────────
    const db = getAdminFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_generation",
      status: "pending",
      input: {
        prompt: promptLines,
        register: "casual",
        length: "medium",
        primary_keyword: proposedKeyword,
        ...(contentAngle ? { content_angle: contentAngle } : {}),
        userId: SYSTEM_USER_ID,
        sourceCalendarId: best.id,
        ...(referenceUrls.length ? { references: { urls: referenceUrls } } : {}),
      },
      result: null,
      error: null,
      userId: SYSTEM_USER_ID,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      triggeredBy: "auto-blog-cron",
    })

    return NextResponse.json(
      {
        jobId: jobRef.id,
        topicId: best.id,
        topicTitle: best.title,
        rank: meta.rank ?? null,
      },
      { status: 202 },
    )
  } catch (err) {
    console.error("[auto-blog] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Best-topic picker: prefers the most recent week's lowest-rank suggestion
 * (rank 1 = highest-ranked). If no rank metadata exists, falls back to most
 * recent created_at.
 */
function pickBestTopic(candidates: ContentCalendarEntry[]): ContentCalendarEntry | null {
  if (candidates.length === 0) return null
  // candidates already ordered by scheduled_for desc.
  const mostRecentWeek = candidates[0].scheduled_for
  const inMostRecentWeek = candidates.filter((c) => c.scheduled_for === mostRecentWeek)
  inMostRecentWeek.sort((a, b) => {
    const ra = (a.metadata as TopicMetadata | null)?.rank ?? 999
    const rb = (b.metadata as TopicMetadata | null)?.rank ?? 999
    if (ra !== rb) return ra - rb
    // Tie-breaker: most recently created
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  return inMostRecentWeek[0] ?? null
}
