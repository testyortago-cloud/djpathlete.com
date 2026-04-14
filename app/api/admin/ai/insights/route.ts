import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAggregatedFeedback, getFeedbackTrends } from "@/lib/db/ai-feedback"
import { getConversationStats } from "@/lib/db/ai-conversations"
import { getAccuracyStats, getWeightPredictionAccuracy } from "@/lib/db/ai-outcomes"
import type { AiFeature } from "@/types/database"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const feature = searchParams.get("feature") as AiFeature | null

    const [feedback, trends, conversationStats, outcomeStats, weightAccuracy] = await Promise.all([
      getAggregatedFeedback(feature ?? undefined),
      getFeedbackTrends(feature ?? undefined),
      getConversationStats(feature ?? undefined),
      getAccuracyStats(),
      getWeightPredictionAccuracy(),
    ])

    return NextResponse.json({
      overview: {
        total_conversations: conversationStats.total_messages,
        total_feedback: feedback.total_count,
        avg_accuracy: feedback.avg_accuracy,
        avg_relevance: feedback.avg_relevance,
        avg_helpfulness: feedback.avg_helpfulness,
        thumbs_up_count: feedback.thumbs_up_count,
        thumbs_down_count: feedback.thumbs_down_count,
      },
      feedback_trends: trends,
      outcomes: {
        total_predictions: outcomeStats.total_predictions,
        resolved_count: outcomeStats.resolved_count,
        avg_accuracy: outcomeStats.avg_accuracy,
        positive_count: outcomeStats.positive_count,
        negative_count: outcomeStats.negative_count,
      },
      weight_accuracy: weightAccuracy,
    })
  } catch (error) {
    console.error("[AI Insights] Error:", error)
    return NextResponse.json({ error: "Failed to fetch AI insights." }, { status: 500 })
  }
}
