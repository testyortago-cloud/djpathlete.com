// functions/src/seo/execute.ts
// One executor per tool. Each returns the new entity id so the memo can
// record execution_target_id. The dispatcher executeAction() routes by
// action.tool — keeps the handler short and the test surface small.

import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getSupabase } from "../lib/supabase.js"
import { notifyBusinessOwners } from "../lib/notify-business-owners.js"
import type { Action } from "./decision-schema.js"
import type { SeoSignalsSummary } from "./signals.js"

export interface AgentContext {
  memoId: string
  userId: string
  /**
   * The business the job was enqueued for: `input.businessId`, stamped by the
   * enqueue route since G35 (the platform's own, by construction — every table
   * this agent reads and writes has no business_id). Only flag_for_human reads
   * it, to find whose owners to bell.
   *
   * Nullable, never optional, and never defaulted: a job enqueued by a route
   * older than G35 carries none, and its flag is then skipped with a reason
   * rather than sent to a guessed business. An optional tenant is how
   * getConversation ended up with `if (businessId)` and a caller that never
   * passed one; a required-but-nullable one makes every caller say which.
   */
  businessId: string | null
}

export interface ExecutionResult {
  executed: boolean
  execution_target_id: string | null
  error?: string
  /** Populated when the dispatcher rejects an action via brief dont_do guardrail. */
  rejection_reason?: string
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
      // CONTRACT: `input.blogPostId` is read by lib/seo-agent/outcomes.ts:resolveRefreshOutcome
      // when Phase 5's outcome tracker resolves this action's outcome 14d later.
      // Renaming this field here REQUIRES updating the resolver in the same commit
      // or the agent's last_8_memos_outcomes signal will be silently empty.
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
      // CONTRACT: `input.targetBlogPostId` is read by lib/seo-agent/outcomes.ts:resolveLinkSweepOutcome
      // when Phase 5's outcome tracker resolves this action's outcome 14d later.
      // Renaming this field here REQUIRES updating the resolver in the same commit.
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
  // Fail closed (G35). No business on the job means no one to address the
  // flag to; it is skipped with a reason seo-agent.ts logs, never defaulted.
  // Checked before the client is even built, so a skipped flag touches nothing.
  if (!ctx.businessId) {
    return {
      executed: false,
      execution_target_id: null,
      error: "job carries no businessId (enqueued before G35?); flag not sent",
    }
  }

  // The owners of the job's business, one bell row each. This used to read
  // `profiles` for "the first admin" — a table that does not exist, so every
  // flag died on PGRST205 (see notifyBusinessOwners for the whole story).
  const outcome = await notifyBusinessOwners(getSupabase(), ctx.businessId, {
    // Map urgency → notifications.type (constrained to info/success/warning/error).
    // 'high' → warning (most-attention category), 'medium'/'low' → info.
    type: args.urgency === "high" ? "warning" : "info",
    title: `SEO Agent: ${args.issue}`,
    message: args.context,
    link: "/admin/seo-agent/memos",
  })
  if (!outcome.ok) {
    return { executed: false, execution_target_id: null, error: outcome.error }
  }
  // ONE id — the first owner's row — because the outcome tracker resolves
  // this by reading a single notification by id 14 days later.
  return { executed: true, execution_target_id: outcome.notificationId }
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function executeAction(
  action: Action,
  ctx: AgentContext,
  signals?: SeoSignalsSummary,
): Promise<ExecutionResult> {
  // Hard guardrail: if the approved brief specifies dont_do phrases, reject any
  // action whose serialized form mentions one. Case-insensitive substring match.
  const dontDo = (signals?.brief_context?.dont_do ?? []) as string[]
  if (dontDo.length > 0) {
    const blob = JSON.stringify(action).toLowerCase()
    const blockedBy = dontDo.find((phrase) => blob.includes(phrase.toLowerCase()))
    if (blockedBy) {
      return {
        executed: false,
        execution_target_id: null,
        rejection_reason: `brief_dont_do:${blockedBy}`,
      }
    }
  }

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
