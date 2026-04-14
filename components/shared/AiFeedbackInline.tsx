"use client"

import { useState, useCallback } from "react"
import { Star, ThumbsUp, ThumbsDown, Send, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { AiFeature } from "@/types/database"

interface AiFeedbackInlineProps {
  messageId: string
  feature: AiFeature
  mode: "admin" | "client"
  className?: string
}

function StarRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [hover, setHover] = useState(0)

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-24">{label}</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="p-0.5 transition-colors"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(star === value ? 0 : star)}
          >
            <Star
              className={cn(
                "h-4 w-4 transition-colors",
                (hover || value) >= star ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

export function AiFeedbackInline({ messageId, feature, mode, className }: AiFeedbackInlineProps) {
  const [accuracy, setAccuracy] = useState(0)
  const [relevance, setRelevance] = useState(0)
  const [helpfulness, setHelpfulness] = useState(0)
  const [notes, setNotes] = useState("")
  const [thumbs, setThumbs] = useState<boolean | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const submitAdminFeedback = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await fetch("/api/admin/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_message_id: messageId,
          feature,
          ...(accuracy > 0 ? { accuracy_rating: accuracy } : {}),
          ...(relevance > 0 ? { relevance_rating: relevance } : {}),
          ...(helpfulness > 0 ? { helpfulness_rating: helpfulness } : {}),
          ...(notes ? { notes } : {}),
        }),
      })
      setSubmitted(true)
    } catch {
      // Silent fail — feedback is non-critical
    } finally {
      setSubmitting(false)
    }
  }, [messageId, feature, accuracy, relevance, helpfulness, notes, submitting])

  const submitClientFeedback = useCallback(
    async (isThumbsUp: boolean) => {
      if (submitting) return
      setThumbs(isThumbsUp)
      setSubmitting(true)
      try {
        await fetch("/api/client/ai-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_message_id: messageId,
            feature,
            thumbs_up: isThumbsUp,
          }),
        })
        setSubmitted(true)
      } catch {
        setThumbs(null)
      } finally {
        setSubmitting(false)
      }
    },
    [messageId, feature, submitting],
  )

  if (submitted) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Check className="h-3 w-3 text-success" />
        Thanks for your feedback
      </div>
    )
  }

  // Client mode: simple thumbs up/down
  if (mode === "client") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 w-7 p-0", thumbs === true && "text-success")}
          onClick={() => submitClientFeedback(true)}
          disabled={submitting}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 w-7 p-0", thumbs === false && "text-error")}
          onClick={() => submitClientFeedback(false)}
          disabled={submitting}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  // Admin mode: multi-dimensional rating
  const hasRating = accuracy > 0 || relevance > 0 || helpfulness > 0

  return (
    <div className={cn("space-y-2 pt-1", className)}>
      <div className="space-y-1">
        <StarRating value={accuracy} onChange={setAccuracy} label="Accuracy" />
        <StarRating value={relevance} onChange={setRelevance} label="Relevance" />
        <StarRating value={helpfulness} onChange={setHelpfulness} label="Helpfulness" />
      </div>

      {showNotes ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes or corrections..."
          className="text-xs h-16 resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add notes
        </button>
      )}

      {hasRating && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={submitAdminFeedback}
          disabled={submitting}
        >
          <Send className="h-3 w-3" />
          {submitting ? "Sending..." : "Submit"}
        </Button>
      )}
    </div>
  )
}
