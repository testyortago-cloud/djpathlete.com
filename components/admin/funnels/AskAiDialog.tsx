"use client"

// Ask AI — three screens in one modal: brief, questions, review.
//
// NOTHING IS EVER APPLIED SILENTLY. The plan lands in a review card and waits
// for "Use this". Discard closes and leaves the create dialog exactly as it
// was. That is not politeness: the plan chooses a template and rewrites the
// step rows, so an owner who half-filled the dialog and clicked Ask AI out of
// curiosity must not lose their work to a model's opinion.
//
// It shares ONE apply path with the examples modal — both call `onApply(plan)`
// — so there is a single way anything writes to those fields.

import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getTemplate } from "@/lib/funnels/templates"
import type { FunnelPlan } from "@/lib/funnels/ai-plan"

interface InterviewQuestion {
  id: string
  question: string
  hint: string | null
  placeholder: string | null
}

interface AskAiDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (plan: FunnelPlan) => void
}

type Screen = "brief" | "questions" | "review"

export function AskAiDialog({ open, onOpenChange, onApply }: AskAiDialogProps) {
  const [screen, setScreen] = useState<Screen>("brief")
  const [brief, setBrief] = useState("")
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<FunnelPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setScreen("brief")
    setBrief("")
    setQuestions([])
    setAnswers({})
    setPlan(null)
    setError(null)
  }

  function close() {
    onOpenChange(false)
    reset()
  }

  async function askQuestions() {
    if (brief.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/admin/funnels/ai/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brief.trim() }),
      })
      const body = (await response.json()) as { questions?: InterviewQuestion[]; error?: string }
      if (!response.ok || !body.questions) {
        setError(body.error ?? "Could not think of questions just now.")
        return
      }
      setQuestions(body.questions)
      setScreen("questions")
    } catch {
      setError("Could not think of questions just now.")
    } finally {
      setBusy(false)
    }
  }

  async function buildPlan() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/admin/funnels/ai/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: brief.trim(),
          answers: questions.map((question) => ({
            question: question.question,
            answer: answers[question.id] ?? "",
          })),
        }),
      })
      const body = (await response.json()) as { plan?: FunnelPlan; error?: string }
      if (!response.ok || !body.plan) {
        setError(body.error ?? "Could not draft a plan just now.")
        return
      }
      setPlan(body.plan)
      setScreen("review")
    } catch {
      setError("Could not draft a plan just now.")
    } finally {
      setBusy(false)
    }
  }

  const answeredCount = questions.filter((question) => (answers[question.id] ?? "").trim()).length

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" aria-hidden />
            Ask AI
          </DialogTitle>
          <DialogDescription>
            {screen === "brief"
              ? "Tell me what you want to build and I'll ask a few questions."
              : screen === "questions"
                ? "Answer what you can — skip anything that doesn't apply."
                : "Here's the plan. Nothing is created until you say so."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md border border-[var(--error)]/30 bg-[var(--error)]/5 px-3 py-2 text-xs text-[var(--error)]">
            {error} You can carry on filling it in yourself.
          </p>
        ) : null}

        {screen === "brief" ? (
          <div className="space-y-1.5">
            <Label htmlFor="ai-brief">What do you want to build?</Label>
            <Textarea
              id="ai-brief"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="A summer camp for junior tennis players"
              rows={3}
              maxLength={600}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">One sentence is enough to start.</p>
          </div>
        ) : null}

        {screen === "questions" ? (
          <div className="space-y-4">
            {questions.map((question) => (
              <div key={question.id} className="space-y-1.5">
                <Label htmlFor={`ai-q-${question.id}`}>{question.question}</Label>
                <Input
                  id={`ai-q-${question.id}`}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  placeholder={question.placeholder ?? ""}
                  maxLength={600}
                />
                {question.hint ? (
                  <p className="text-xs text-muted-foreground">{question.hint}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {screen === "review" && plan ? (
          <div
            data-testid="ai-plan-review"
            className="space-y-3 rounded-lg border border-border bg-surface/40 p-3 text-sm"
          >
            <Row label="Kind" value={getTemplate(plan.template)?.label ?? plan.template} />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Steps</p>
              <ol className="mt-1 space-y-0.5">
                {plan.steps.map((step, index) => (
                  <li key={step.slug} className="text-sm">
                    <span className="text-muted-foreground">{index + 1}.</span> {step.name}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">/{step.slug}</span>
                  </li>
                ))}
              </ol>
            </div>
            {plan.name ? <Row label="Name" value={plan.name} /> : null}
            {plan.audience ? <Row label="For" value={plan.audience} /> : null}
            {plan.offer ? <Row label="Offer" value={plan.offer.ref} /> : null}
            {plan.description ? <Row label="About" value={plan.description} /> : null}
          </div>
        ) : null}

        <DialogFooter>
          {screen === "brief" ? (
            <>
              <Button variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={askQuestions} disabled={busy || brief.trim().length < 3}>
                {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {busy ? "Thinking…" : "Ask me questions"}
              </Button>
            </>
          ) : null}

          {screen === "questions" ? (
            <>
              <Button variant="outline" onClick={() => setScreen("brief")} disabled={busy}>
                Back
              </Button>
              {/* Enabled with nothing answered: every question is skippable, and
                  a plan from the brief alone is still better than a blank form. */}
              <Button onClick={buildPlan} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {busy ? "Drafting…" : `Build my plan${answeredCount ? ` (${answeredCount})` : ""}`}
              </Button>
            </>
          ) : null}

          {screen === "review" && plan ? (
            <>
              <Button variant="outline" onClick={close}>
                Discard
              </Button>
              <Button
                onClick={() => {
                  onApply(plan)
                  close()
                }}
              >
                Use this
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}
