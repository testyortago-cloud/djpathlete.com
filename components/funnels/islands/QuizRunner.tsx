"use client"

// The visitor's walk through a scored quiz.
//
// THIS COMPONENT NEVER COMPUTES A RESULT. It holds answers and asks the server
// for the score. It is not given the weights to compute one with — see
// `publicQuizDefinition` — which is why a result cannot be forged by a
// determined visitor with dev tools open.
//
// ONE QUESTION AT A TIME, and the next one is not in the document until the
// current one is answered. That is a rendering decision, not CSS: a hidden
// question is still readable in view-source, and the ordering of a branching
// quiz would leak which archetype each option leads to.
//
// NO dangerouslySetInnerHTML ANYWHERE. Every string here is either the owner's
// own copy from the database or the visitor's own input, and both go through
// React's text escaping. A test asserts the source contains no such call.

import { useCallback, useMemo, useState } from "react"
import type { PublicQuizDefinition, PublicQuizQuestion } from "@/lib/quizzes/public-definition"

export interface QuizResultView {
  score: number
  tier: { key: string; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null } | null
  profile: { key: string; name: string; description: string } | null
  branch: { key: string; name: string } | null
}

interface QuizRunnerProps {
  definition: PublicQuizDefinition
  submitLabel: string
  consentText?: string
  /** Rendered beside the phone field. Absent means no SMS checkbox at all. */
  smsConsentWording?: string
  /** The builder iframe and `/go?preview=1`: refuse outright. */
  isPreview?: boolean
  /** `/preview/<slug>`: score for real, write nothing. */
  testRun?: boolean
  /**
   * WHERE THIS QUIZ IS STANDING. `FunnelRenderContext` carries both to every
   * island; posting them is what lets a completion be filed as a lead on the
   * funnel that asked. Absent when the quiz is not on a funnel page, and the
   * route then writes no submission rather than inventing a funnel.
   */
  funnelId?: string
  stepId?: string
}

type Phase = "intro" | "questions" | "gate" | "result"

export function QuizRunner({
  definition,
  submitLabel,
  consentText,
  smsConsentWording,
  isPreview = false,
  testRun = false,
  funnelId,
  stepId,
}: QuizRunnerProps) {
  const [phase, setPhase] = useState<Phase>("intro")
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [result, setResult] = useState<QuizResultView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [startedAt] = useState(() => Date.now())

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [smsConsent, setSmsConsent] = useState(false)
  const [website, setWebsite] = useState("")

  /**
   * THE BRANCH IS DERIVED FROM THE ANSWERS, exactly as the server derives it.
   * The client needs it to know which questions to ask next; the server never
   * takes the client's word for it.
   */
  const branchId = useMemo(() => {
    for (const question of definition.questions) {
      if (question.branchId !== null) continue
      const chosen = answers[question.id]
      if (!chosen) continue
      const option = question.options.find((candidate) => candidate.id === chosen)
      if (option?.routesToBranchId) return option.routesToBranchId
    }
    return null
  }, [definition.questions, answers])

  /** Shared questions plus the chosen branch's own, in global position order. */
  const walk: PublicQuizQuestion[] = useMemo(
    () =>
      definition.questions
        .filter((question) => question.branchId === null || question.branchId === branchId)
        .slice()
        .sort((a, b) => a.position - b.position),
    [definition.questions, branchId],
  )

  const current = walk[index]

  const postProgress = useCallback(
    async (next: Record<string, string>) => {
      // A TEST RUN WRITES NOTHING, INCLUDING PROGRESS. A preview that posted
      // progress would write quiz_attempts rows from a page whose whole
      // promise is that it does not write.
      if (testRun || isPreview) return
      try {
        const res = await fetch("/api/quiz/progress", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quizId: definition.id,
            attemptId: attemptId ?? undefined,
            answers: Object.entries(next).map(([questionId, optionId]) => ({ questionId, optionId })),
          }),
        })
        if (res.ok) {
          const json = (await res.json()) as { attemptId?: string }
          if (json.attemptId) setAttemptId(json.attemptId)
        }
      } catch {
        // Progress is a convenience for us, never a blocker for them. A
        // visitor whose network blipped keeps answering.
      }
    },
    [attemptId, definition.id, isPreview, testRun],
  )

  const choose = useCallback(
    (questionId: string, optionId: string) => {
      const next = { ...answers, [questionId]: optionId }
      setAnswers(next)
      void postProgress(next)
      // Recomputing the walk here would use the STALE `walk` above, so the
      // decision is only "was this the last question I currently know about?".
      // Answering the router lengthens the walk, and the effect is that the
      // next render simply has more to show.
      setIndex((i) => i + 1)
    },
    [answers, postProgress],
  )

  const back = useCallback(() => {
    setError(null)
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  const atEnd = index >= walk.length

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (isPreview && !testRun) {
      setError("This is a preview. Submissions are disabled here.")
      return
    }
    setBusy(true)
    try {
      const endpoint = testRun ? "/api/quiz/preview-submit" : "/api/quiz/submit"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          testRun
            ? {
                quizId: definition.id,
                answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })),
              }
            : {
                quizId: definition.id,
                attemptId,
                // THE TEST-RUN BRANCH ABOVE MUST NOT GAIN THESE. Its route
                // accepts `{quizId, answers}` and writes nothing at all; a
                // funnel id in that body is the first half of a preview that
                // files leads.
                funnelId,
                stepId,
                answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })),
                name,
                email,
                phone: phone || undefined,
                smsConsent,
                website,
                elapsedMs: Date.now() - startedAt,
              },
        ),
      })
      if (!res.ok) {
        setError("Something went wrong. Please try again.")
        return
      }
      setResult((await res.json()) as QuizResultView)
      setPhase("result")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (phase === "intro") {
    return (
      <div className="djp-quiz">
        {testRun ? <p className="djp-test-run">Test run</p> : null}
        {definition.introHeadline ? <h3 className="djp-quiz-prompt">{definition.introHeadline}</h3> : null}
        {definition.introBody ? <p className="djp-quiz-help">{definition.introBody}</p> : null}
        <div className="djp-quiz-nav">
          <button type="button" className="djp-btn djp-btn-primary" onClick={() => setPhase("questions")}>
            Start
          </button>
        </div>
      </div>
    )
  }

  if (phase === "result" && result) {
    return (
      <div className="djp-quiz djp-quiz-result">
        {testRun ? <p className="djp-test-run">Test run</p> : null}
        {result.tier ? <p className="djp-quiz-tier">{result.tier.headline}</p> : null}
        <p className="djp-quiz-score">{result.score}</p>
        <p className="djp-quiz-scale">out of 100</p>
        {result.tier ? <p className="djp-quiz-profile-body">{result.tier.body}</p> : null}
        {result.profile ? (
          <div className="djp-quiz-profile">
            <p className="djp-quiz-profile-name">{result.profile.name}</p>
            <p className="djp-quiz-profile-body">{result.profile.description}</p>
          </div>
        ) : null}
        {result.tier?.ctaLabel && result.tier?.ctaHref ? (
          <div className="djp-quiz-nav">
            <a className="djp-btn djp-btn-primary" href={result.tier.ctaHref}>
              {result.tier.ctaLabel}
            </a>
          </div>
        ) : null}
      </div>
    )
  }

  // THE GATE APPEARS ONLY AFTER THE LAST WALKED QUESTION. Partial answers are
  // already saved by then, so a drop-off here is still a known lead.
  if (phase === "gate" || atEnd) {
    return (
      <form className="djp-quiz djp-quiz-gate" onSubmit={submit} noValidate>
        {testRun ? <p className="djp-test-run">Test run</p> : null}
        {definition.gateHeadline ? <h3 className="djp-quiz-prompt">{definition.gateHeadline}</h3> : null}
        {definition.gateBody ? <p className="djp-quiz-help">{definition.gateBody}</p> : null}

        <div className="djp-quiz-field">
          <label className="djp-quiz-label" htmlFor="djp-quiz-name">
            Your name
          </label>
          <input
            id="djp-quiz-name"
            className="djp-quiz-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="djp-quiz-field">
          <label className="djp-quiz-label" htmlFor="djp-quiz-email">
            Email
          </label>
          <input
            id="djp-quiz-email"
            className="djp-quiz-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="djp-quiz-field">
          <label className="djp-quiz-label" htmlFor="djp-quiz-phone">
            Mobile number (optional)
          </label>
          <input
            id="djp-quiz-phone"
            className="djp-quiz-input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {/* Absent wording means no checkbox at all — never a checkbox whose
            sentence cannot name the business. */}
        {smsConsentWording ? (
          <label className="djp-quiz-consent">
            <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
            <span>{smsConsentWording}</span>
          </label>
        ) : null}

        {consentText ? <p className="djp-quiz-consent">{consentText}</p> : null}

        {/* Honeypot. Off-screen rather than display:none, which some bots skip. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px" }}
        />

        {error ? <p className="djp-quiz-error">{error}</p> : null}

        <div className="djp-quiz-nav">
          <button type="submit" className="djp-btn djp-btn-primary" disabled={busy}>
            {busy ? "Scoring…" : submitLabel}
          </button>
          <button type="button" className="djp-quiz-back" onClick={back}>
            Back
          </button>
        </div>
      </form>
    )
  }

  if (!current) return null

  const answered = answers[current.id]

  /**
   * THE TOTAL IS UNKNOWABLE UNTIL THE ROUTER IS ANSWERED, so it is not shown.
   *
   * Found by looking at a screenshot, not by a test: before branching, the
   * walk is the six shared questions, so the counter read "Question 1 of 6".
   * The moment the visitor picked an archetype it became "Question 2 of 13".
   * Being told a quiz is six questions long, answering one, and then being
   * told it is thirteen is worse than not being given a number at all.
   *
   * Every unit test here asserts WHICH question is shown and none of them
   * looked at the counter, which is exactly the class of false-positive a
   * guard's own tests structurally cannot see.
   */
  const totalKnown = branchId !== null
  const progress = totalKnown && walk.length > 0 ? Math.round((index / walk.length) * 100) : 0

  return (
    <div className="djp-quiz">
      {testRun ? <p className="djp-test-run">Test run</p> : null}
      <div className="djp-quiz-progress">
        <div className="djp-quiz-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <p className="djp-quiz-step">
        {totalKnown ? `Question ${index + 1} of ${walk.length}` : `Question ${index + 1}`}
      </p>
      <h3 className="djp-quiz-prompt">{current.prompt}</h3>
      {current.helpText ? <p className="djp-quiz-help">{current.helpText}</p> : null}
      <ul className="djp-quiz-options">
        {current.options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className="djp-quiz-option"
              aria-pressed={answered === option.id}
              onClick={() => choose(current.id, option.id)}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
      {index > 0 ? (
        <div className="djp-quiz-nav">
          <button type="button" className="djp-quiz-back" onClick={back}>
            Back
          </button>
        </div>
      ) : null}
    </div>
  )
}
