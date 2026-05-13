// functions/src/seo/execute.ts
// One executor per tool. Each returns the new entity id so the memo can
// record execution_target_id. The dispatcher executeAction() routes by
// action.tool — keeps the handler short and the test surface small.

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "../lib/supabase.js"
import type { Action } from "./decision-schema.js"

export interface AgentContext {
  memoId: string
  userId: string
}

export interface ExecutionResult {
  executed: boolean
  execution_target_id: string | null
  error?: string
}

// ─── queue_new_post ────────────────────────────────────────────────────────

export async function executeQueueNewPost(
  args: { keyword: string; angle: string; references?: string[] },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  const supabase = getSupabase()
  const nextTuesday = nextWeekdayIso(2) // 2 = Tuesday in JS Date.getDay()
  const { data, error } = await supabase
    .from("content_calendar")
    .insert({
      entry_type: "topic_suggestion",
      title: args.keyword,
      scheduled_for: nextTuesday,
      status: "planned",
      metadata: {
        source: "seo_agent",
        rank: 1,
        primary_keyword: args.keyword,
        angle: args.angle,
        references: args.references ?? [],
        memo_id: ctx.memoId,
      },
    })
    .select("id")
    .single()
  if (error || !data) {
    return { executed: false, execution_target_id: null, error: error?.message ?? "insert failed" }
  }
  return { executed: true, execution_target_id: (data as { id: string }).id }
}

// ─── queue_refresh ─────────────────────────────────────────────────────────

export async function executeQueueRefresh(
  args: { blog_post_id: string; reason: string },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  try {
    const db = getFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "blog_refresh",
      status: "pending",
      input: {
        blogPostId: args.blog_post_id,
        triggerReason: `seo_agent: ${args.reason}`,
        userId: ctx.userId,
      },
      result: null,
      error: null,
      userId: ctx.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      triggeredBy: "seo_agent_run",
      memoId: ctx.memoId,
    })
    return { executed: true, execution_target_id: jobRef.id }
  } catch (err) {
    return { executed: false, execution_target_id: null, error: (err as Error).message }
  }
}

// ─── queue_internal_link_sweep ─────────────────────────────────────────────

export async function executeQueueInternalLinkSweep(
  args: { target_blog_post_id: string; candidate_anchor_post_ids: string[] },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  try {
    const db = getFirestore()
    const jobRef = db.collection("ai_jobs").doc()
    await jobRef.set({
      type: "internal_link_sweep",
      status: "pending",
      input: {
        targetBlogPostId: args.target_blog_post_id,
        candidateAnchorPostIds: args.candidate_anchor_post_ids,
        userId: ctx.userId,
      },
      result: null,
      error: null,
      userId: ctx.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      triggeredBy: "seo_agent_run",
      memoId: ctx.memoId,
    })
    return { executed: true, execution_target_id: jobRef.id }
  } catch (err) {
    return { executed: false, execution_target_id: null, error: (err as Error).message }
  }
}

// ─── flag_for_human ────────────────────────────────────────────────────────

export async function executeFlagForHuman(
  args: { issue: string; urgency: "low" | "medium" | "high"; context: string },
  ctx: AgentContext,
): Promise<ExecutionResult> {
  const supabase = getSupabase()

  // Resolve admin user via role lookup. Solo-dev project — one admin row.
  const { data: admins, error: adminErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
  if (adminErr) {
    return { executed: false, execution_target_id: null, error: adminErr.message }
  }
  const adminId = (admins as Array<{ id: string }> | null)?.[0]?.id
  if (!adminId) {
    return { executed: false, execution_target_id: null, error: "no admin user found" }
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: adminId,
      // Map urgency → notifications.type (constrained to info/success/warning/error).
      // 'high' → warning (most-attention category), 'medium'/'low' → info.
      type: args.urgency === "high" ? "warning" : "info",
      title: `SEO Agent: ${args.issue}`,
      message: args.context,
      link: "/admin/seo-agent/memos",
      is_read: false,
    })
    .select("id")
    .single()
  if (error || !data) {
    return { executed: false, execution_target_id: null, error: error?.message ?? "notification insert failed" }
  }
  return { executed: true, execution_target_id: (data as { id: string }).id }
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function executeAction(action: Action, ctx: AgentContext): Promise<ExecutionResult> {
  switch (action.tool) {
    case "queue_new_post":
      return executeQueueNewPost(action.args, ctx)
    case "queue_refresh":
      return executeQueueRefresh(action.args, ctx)
    case "queue_internal_link_sweep":
      return executeQueueInternalLinkSweep(action.args, ctx)
    case "flag_for_human":
      return executeFlagForHuman(action.args, ctx)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function nextWeekdayIso(targetDayOfWeek: number): string {
  const d = new Date()
  const dayOfWeek = d.getUTCDay()
  const daysAhead = (targetDayOfWeek - dayOfWeek + 7) % 7 || 7
  d.setUTCDate(d.getUTCDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}
