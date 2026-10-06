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

import { useCallback, useEffect, useMemo, useState } from "react"
import { browserTimezone } from "@/lib/browser-timezone"
import { readCarriedContact } from "@/lib/funnels/carried-contact"
import type { PublicQuizDefinition, PublicQuizQuestion } from "@/lib/quizzes/public-definition"
import type { MapRow, MirrorLine } from "@/lib/quizzes/report"

export interface QuizResultView {
  score: number
  tier: { key: string; headline: string; body: string; ctaLabel: string | null; ctaHref: string | null } | null
  profile: { key: string; name: string; description: string } | null
  branch: { key: string; name: string } | null
  /** Absent on a response from before the mini-assessment shipped. */
  mirror?: MirrorLine[]
  map?: MapRow[]
}

const STATUS_LABEL: Record<MapRow["status"], string> = { solid: "Solid", watch: "Watch", leak: "Leak", gap: "Left/right gap" }
const SIDE_LABEL = { left: "Left", right: "Right", single: "Score" } as const

interface QuizRunnerProps {
  definition: PublicQuizDefinition
  submitLabel: string
  consentText?: string
  /** Rendered beside the phone field. Absent means no SMS checkbox at all. */
  smsConsentWording?: string
  /**
   * Rendered beside the email field. Absent means no email consent checkbox
   * at all — mirrors `smsConsentWording` exactly, decision 7's email
   * equivalent of the same tick.
   */
  emailConsentWording?: string
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
  emailConsentWording,
  isPreview = false,
  testRun = false,
  funnelId,
  stepId,
}: QuizRunnerProps) {
  // No intro copy means no intro screen: a quiz behind a landing page that
  // already said what it is opens straight on its first question, rather than
  // on a lone "Start" button.
  const [phase, setPhase] = useState<Phase>(definition.introHeadline || definition.introBody ? "intro" : "questions")
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [result, setResult] = useState<QuizResultView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Keyed by question id, so it resets on every question change with no effect.
  const [mistakesFor, setMistakesFor] = useState<string | null>(null)
  const [startedAt] = useState(() => Date.now())

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [smsConsent, setSmsConsent] = useState(false)
  const [emailConsent, setEmailConsent] = useState(false)
  const [website, setWebsite] = useState("")

  // A landing form earlier in the funnel may already have the name and email.
  // After mount, never in the initialiser: the server render has no storage.
  useEffect(() => {
    const carried = readCarriedContact()
    if (!carried) return
    if (carried.name) setName((current) => current || carried.name)
    if (carried.email) setEmail((current) => current || carried.email)
  }, [])

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
                emailConsent,
                website,
                elapsedMs: Date.now() - startedAt,
                // G06. Deliberately NOT on the test-run branch above, which
                // writes nothing. Its route would not complain either way — a
                // plain z.object STRIPS unknown keys rather than rejecting
                // them — so keeping it off that branch is the only thing that
                // keeps the preview body honest about what it sends.
                timezone: browserTimezone(),
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
        {(() => {
          const map = result.map ?? []
          const assessment = map.length > 0
          const sides = (row: MapRow) =>
            (["left", "right", "single"] as const).flatMap((side) => (row[side] === null ? [] : [[side, row[side] as number] as const]))
          return (
            <>
              {assessment && result.mirror?.length ? (
                <div className="djp-quiz-mirror">
                  <p className="djp-quiz-section-title">What you told us</p>
                  <dl>
                    {result.mirror.map((line) => (
                      <div key={line.prompt}>
                        <dt>{line.prompt}</dt>
                        <dd>{line.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              {result.tier
                ? result.tier.body.split(/\n\s*\n/).map((paragraph, index) => (
                    <p key={index} className="djp-quiz-profile-body">{paragraph}</p>
                  ))
                : null}
              {assessment ? (
                <div className="djp-quiz-map">
                  <p className="djp-quiz-section-title">Your movement map</p>
                  <ul>
                    {map.map((row) => (
                      <li key={row.label} className="djp-quiz-map-row">
                        <span className="djp-quiz-map-label">{row.label}</span>
                        <span className="djp-quiz-map-sides">
                          {sides(row).map(([side, points]) => (
                            <span key={side} className="djp-quiz-meter" aria-label={`${SIDE_LABEL[side]}: ${points} of ${row.max}`}>
                              {side === "single" ? null : <span className="djp-quiz-meter-side">{side === "left" ? "L" : "R"}</span>}
                              <span className="djp-quiz-meter-track">
                                <span className="djp-quiz-meter-fill" style={{ width: `${(points / row.max) * 100}%` }} />
                              </span>
                              <span className="djp-quiz-meter-value">{points}/{row.max}</span>
                            </span>
                          ))}
                        </span>
                        <span className="djp-quiz-status" data-status={row.status}>{STATUS_LABEL[row.status]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )
        })()}
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

        {/* Absent wording means no checkbox at all — never a checkbox whose
            sentence cannot name the business. Mirrors the SMS tick below. */}
        {emailConsentWording ? (
          <label className="djp-quiz-consent">
            <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} />
            <span>{emailConsentWording}</span>
          </label>
        ) : null}

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
  // A quiz with no branches has nothing to lengthen its walk, so its total is
  // known from the first question.
  const totalKnown = branchId !== null || definition.branches.length === 0
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
      {/*
        THE DEMO CLIP, AND WHY IT LOOPS SILENTLY WITH CONTROLS.
        `loop` + `muted` + `playsInline` is what lets it autoplay at all —
        every browser blocks an unmuted autoplay, and a clip that needs a tap
        before the movement is visible is a clip most visitors never watch.
        `controls` stays because the viewer must be able to scrub back: they
        are being asked to compare their own attempt against it.
        `preload="none"` with a poster keeps a 12-question walk from fetching
        nine videos up front over a phone connection.
        The mistakes clip keeps its audio track, so a visitor can unmute
        Darren naming each mistake.
      */}
      {(() => {
        const showMistakes = mistakesFor === current.id && Boolean(current.mistakesMediaUrl)
        const src = showMistakes ? current.mistakesMediaUrl : current.mediaUrl
        const poster = showMistakes ? current.mistakesMediaPosterUrl : current.mediaPosterUrl
        return (
          <>
            {current.mistakesMediaUrl ? (
              <div className="djp-quiz-toggle" role="group" aria-label="Which clip to watch">
                <button type="button" aria-pressed={!showMistakes} onClick={() => setMistakesFor(null)}>How to do it</button>
                <button type="button" aria-pressed={showMistakes} onClick={() => setMistakesFor(current.id)}>Common mistakes</button>
              </div>
            ) : null}
            {src ? (
              <video key={src} className="djp-quiz-media" src={src} poster={poster ?? undefined}
                preload="none" controls loop muted playsInline />
            ) : null}
          </>
        )
      })()}
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
