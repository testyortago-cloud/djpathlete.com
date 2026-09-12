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
import { isCronSkipped } from "@/lib/db/system-settings"
import { proposePrimaryKeyword } from "@/lib/blog/keyword-proposal"
import { extractContentAngle } from "@/lib/blog/content-angle"
import { findInFlightBlogSuggestionJob } from "@/lib/ai-jobs"
import { pickDiverseTopic, RECENT_THEME_WINDOW, type RankableTopic } from "@/lib/blog/topic-rotation"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import type { ContentCalendarEntry } from "@/types/database"

interface TopicMetadata {
  rank?: number
  tavily_url?: string
  summary?: string
  source?: string
}

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const expected = process.env.INTERNAL_CRON_TOKEN
  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Combined gate: skip if globally paused OR per-job toggle is off
    // (default false for this cron — opt-in).
    const gate = await isCronSkipped({
      enabledKey: "cron_auto_blog_enabled",
      defaultEnabled: false,
    })
    if (gate.skipped) {
      console.log(`[auto-blog] skipped — ${gate.reason}`)
      return NextResponse.json({ skipped: gate.reason }, { status: 200 })
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

    // What we have written lately, newest first. This is what makes the pick
    // rotate: without it the cron re-picks the same theme for as long as the
    // ranker keeps putting that theme at rank 1.
    const { data: recentPosts, error: recentErr } = await supabase
      .from("blog_posts")
      .select("title")
      .order("created_at", { ascending: false })
      .limit(RECENT_THEME_WINDOW * 3)
    if (recentErr) {
      // Fail open — an unrotated post beats no post. Logged so a persistent
      // failure is visible rather than quietly reverting to the old behaviour.
      console.warn("[auto-blog] recent-posts read failed, rotation disabled this run:", recentErr.message)
    }
    const recentTitles = (recentPosts ?? []).map((r) => (r as { title?: string }).title).filter((t): t is string => !!t)

    const picked = pickDiverseTopic(candidates.map(toRankable), recentTitles)
    if (!picked) {
      console.log("[auto-blog] skipped — every queued topic duplicates something recent")
      return NextResponse.json({ skipped: "no_rankable_topic" }, { status: 200 })
    }
    const best = candidates.find((c) => c.id === picked.topic.id)!

    const meta = (best.metadata ?? {}) as TopicMetadata
    const promptLines = [best.title, meta.summary].filter(Boolean).join("\n\n")
    const referenceUrls = meta.tavily_url ? [meta.tavily_url] : []

    // Duplicate guard: if a job for this topic is already pending/processing
    // (e.g. the admin clicked "Generate draft" moments before the cron fired),
    // attach to it instead of paying for a second generation. Fails open.
    try {
      const existing = await findInFlightBlogSuggestionJob(best.id)
      if (existing) {
        console.warn(`[auto-blog] duplicate absorbed — job ${existing} already in flight for topic ${best.id}`)
        return NextResponse.json({ jobId: existing, topicId: best.id, deduped: true }, { status: 202 })
      }
    } catch (err) {
      console.warn("[auto-blog] in-flight check failed (continuing):", (err as Error).message)
    }

    // ── Run keyword + angle proposals in parallel ─────────────────────────
    const [proposedKeyword, contentAngle] = await Promise.all([
      proposePrimaryKeyword({ title: best.title, summary: meta.summary }),
      extractContentAngle({ title: best.title, summary: meta.summary }),
    ])
    console.log(
      `[auto-blog] picked topic id=${best.id} rank=${meta.rank ?? "?"} theme=${picked.theme} ` +
        `via=${picked.reason} title="${best.title.slice(0, 60)}..." keyword="${proposedKeyword}" ` +
        `angle=${contentAngle ? "yes" : "no"}`,
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
        theme: picked.theme,
        pickedVia: picked.reason,
      },
      { status: 202 },
    )
  } catch (err) {
    console.error("[auto-blog] error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Adapts a content_calendar row to the shape the rotation picker needs. The
 * picker deliberately knows nothing about content_calendar — it is pure and
 * unit-tested against plain objects.
 */
function toRankable(entry: ContentCalendarEntry): RankableTopic {
  return {
    id: entry.id,
    title: entry.title,
    scheduled_for: entry.scheduled_for,
    created_at: entry.created_at,
    rank: (entry.metadata as TopicMetadata | null)?.rank ?? null,
  }
}
