import { embedText } from "@/lib/ai/embeddings"
import {
  searchSimilarProgramFeedback,
  getRecentProgramFeedback,
  updateProgramFeedbackEmbedding,
  type ProgramFeedbackSearchResult,
} from "@/lib/db/ai-program-feedback"
import type { AiProgramFeedback, ProgramFeedbackIssue } from "@/types/database"
import { estimateTokens } from "@/lib/ai/token-utils"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IssuePattern {
  category: string
  count: number
  avgSeverity: string
  sampleDescriptions: string[]
}

export interface FeedbackContext {
  patterns: IssuePattern[]
  promptText: string
  feedbackCount: number
}

// ─── Embed program feedback (async, fire-and-forget) ─────────────────────────

export async function embedProgramFeedback(feedbackId: string): Promise<void> {
  // We need to fetch the feedback to build the text
  // Use getRecentProgramFeedback with a high limit and find our ID
  // Or better: import a direct getter. For simplicity, we'll use the supabase client directly here to avoid circular deps
  const { createServiceRoleClient } = await import("@/lib/supabase")
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("ai_program_feedback")
    .select("*")
    .eq("id", feedbackId)
    .single()
  if (error || !data) return

  const feedback = data as AiProgramFeedback
  const issueCategories = feedback.specific_issues
    .map((i) => i.category)
    .join(", ")

  const textToEmbed = [
    `Program feedback | split: ${feedback.split_type ?? "unknown"}`,
    `difficulty: ${feedback.difficulty ?? "unknown"}`,
    `overall: ${feedback.overall_rating}/5`,
    `balance: ${feedback.balance_quality ?? "N/A"}/5`,
    `exercise selection: ${feedback.exercise_selection_quality ?? "N/A"}/5`,
    `periodization: ${feedback.periodization_quality ?? "N/A"}/5`,
    issueCategories ? `issues: ${issueCategories}` : "",
    feedback.notes ? `notes: ${feedback.notes}` : "",
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 2000)

  const embedding = await embedText(textToEmbed)
  await updateProgramFeedbackEmbedding(feedbackId, embedding)
}

// ─── Build feedback context for prompt injection ─────────────────────────────

export async function buildFeedbackContext(
  splitType: string | null,
  difficulty: string | null,
  goals: string[],
  opts?: { timeoutMs?: number; maxTokens?: number }
): Promise<FeedbackContext> {
  const timeoutMs = opts?.timeoutMs ?? 2000
  const maxTokens = opts?.maxTokens ?? 800

  const empty: FeedbackContext = { patterns: [], promptText: "", feedbackCount: 0 }

  try {
    return await Promise.race([
      doFeedbackRetrieval(splitType, difficulty, goals, maxTokens),
      new Promise<FeedbackContext>((_, reject) =>
        setTimeout(() => reject(new Error("Feedback retrieval timed out")), timeoutMs)
      ),
    ])
  } catch {
    return empty
  }
}

async function doFeedbackRetrieval(
  splitType: string | null,
  difficulty: string | null,
  goals: string[],
  maxTokens: number
): Promise<FeedbackContext> {
  // Two retrieval strategies in parallel: vector search + recent feedback
  const queryText = [
    splitType ? `${splitType} split` : "",
    difficulty ?? "",
    goals.join(", "),
    "program generation feedback",
  ]
    .filter(Boolean)
    .join(" ")

  const [vectorResults, recentResults] = await Promise.all([
    // Vector search for semantically similar feedback
    embedText(queryText).then((embedding) =>
      searchSimilarProgramFeedback(embedding, {
        splitType: splitType ?? undefined,
        difficulty: difficulty ?? undefined,
        threshold: 0.3,
        limit: 10,
      })
    ).catch(() => [] as ProgramFeedbackSearchResult[]),
    // Recent feedback with same split/difficulty
    getRecentProgramFeedback({
      splitType: splitType ?? undefined,
      difficulty: difficulty ?? undefined,
      limit: 20,
    }).catch(() => [] as AiProgramFeedback[]),
  ])

  // Merge and deduplicate
  const seenIds = new Set<string>()
  const allFeedback: Array<{
    specific_issues: ProgramFeedbackIssue[]
    overall_rating: number
    notes: string | null
  }> = []

  for (const r of vectorResults) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id)
      allFeedback.push({
        specific_issues: r.specific_issues as ProgramFeedbackIssue[],
        overall_rating: r.overall_rating,
        notes: r.notes,
      })
    }
  }

  for (const r of recentResults) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id)
      allFeedback.push({
        specific_issues: r.specific_issues,
        overall_rating: r.overall_rating,
        notes: r.notes,
      })
    }
  }

  if (allFeedback.length === 0) {
    return { patterns: [], promptText: "", feedbackCount: 0 }
  }

  const patterns = aggregateIssuePatterns(allFeedback)
  const promptText = formatFeedbackForPrompt(patterns, maxTokens)

  return {
    patterns,
    promptText,
    feedbackCount: allFeedback.length,
  }
}

// ─── Aggregate issue patterns ────────────────────────────────────────────────

function aggregateIssuePatterns(
  feedbacks: Array<{
    specific_issues: ProgramFeedbackIssue[]
    overall_rating: number
    notes: string | null
  }>
): IssuePattern[] {
  const categoryMap = new Map<
    string,
    { count: number; severities: string[]; descriptions: string[] }
  >()

  for (const fb of feedbacks) {
    for (const issue of fb.specific_issues) {
      const existing = categoryMap.get(issue.category) ?? {
        count: 0,
        severities: [],
        descriptions: [],
      }
      existing.count++
      existing.severities.push(issue.severity)
      if (issue.description && existing.descriptions.length < 3) {
        existing.descriptions.push(issue.description)
      }
      categoryMap.set(issue.category, existing)
    }
  }

  // Sort by frequency descending
  return Array.from(categoryMap.entries())
    .map(([category, data]) => {
      // Calculate most common severity
      const severityCounts = { low: 0, medium: 0, high: 0 }
      for (const s of data.severities) {
        if (s in severityCounts) severityCounts[s as keyof typeof severityCounts]++
      }
      const avgSeverity =
        severityCounts.high >= severityCounts.medium && severityCounts.high >= severityCounts.low
          ? "high"
          : severityCounts.medium >= severityCounts.low
            ? "medium"
            : "low"

      return {
        category,
        count: data.count,
        avgSeverity,
        sampleDescriptions: data.descriptions,
      }
    })
    .sort((a, b) => b.count - a.count)
}

// ─── Format for prompt injection ─────────────────────────────────────────────

function formatFeedbackForPrompt(
  patterns: IssuePattern[],
  maxTokens: number
): string {
  if (patterns.length === 0) return ""

  const header = `## Past Program Feedback Patterns

The following issues have been identified by coaches reviewing previous AI-generated programs. ACTIVELY AVOID repeating these patterns:\n\n`

  let body = ""
  for (const pattern of patterns) {
    const categoryLabel = pattern.category.replace(/_/g, " ")
    const section = `### ${categoryLabel} (seen ${pattern.count} time${pattern.count > 1 ? "s" : ""}, severity: ${pattern.avgSeverity})
${pattern.sampleDescriptions.map((d) => `- "${d}"`).join("\n")}

`
    // Check token budget before adding
    if (estimateTokens(header + body + section) > maxTokens) break
    body += section
  }

  if (!body) return ""
  return header + body.trimEnd()
}
