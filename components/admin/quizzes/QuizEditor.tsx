"use client"

// The quiz editor. Five panels: details, branches, questions, tiers, profiles.
//
// THE ACTIVATE BUTTON AND THE SAVE API RUN THE SAME FUNCTION. `quizGate` is a
// pure module with no I/O, which is exactly what lets it run in this browser
// and again on the server — the button is the courtesy, the route is the
// control, and neither can drift from the other because there is only one
// implementation of "is this quiz fit to go live".
//
// The blockers are LISTED, never a silent disable. A greyed-out button with no
// reason is a support ticket.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { quizGate } from "@/lib/quizzes/gate"
import type { QuizDefinition, QuizOption, QuizQuestion } from "@/lib/quizzes/types"

type Panel = "details" | "branches" | "questions" | "tiers" | "profiles"

const PANELS: { key: Panel; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "branches", label: "Branches" },
  { key: "questions", label: "Questions" },
  { key: "tiers", label: "Tiers" },
  { key: "profiles", label: "Profiles" },
]

const EVERYONE = "__everyone__"

export function QuizEditor({ initial }: { initial: QuizDefinition }) {
  const router = useRouter()
  const [quiz, setQuiz] = useState<QuizDefinition>(initial)
  const [panel, setPanel] = useState<Panel>("details")
  const [branchTab, setBranchTab] = useState<string>(EVERYONE)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [serverBlockers, setServerBlockers] = useState<string[] | null>(null)
  // ---------------------------------------------------------------------
  // WHAT THIS SAVE WILL INSERT AND DELETE.
  //
  // `quiz` above is the state the owner is looking at. These two say how it
  // differs from the server's — which is not derivable from `quiz` alone,
  // because a removed row is simply absent from it and a new row looks exactly
  // like an existing one.
  //
  // A ROW ADDED AND REMOVED BEFORE SAVING NEVER EXISTED: `removeQuestion`
  // takes it out of `newIds` rather than putting it into `deletedIds`, so the
  // server is never asked to delete a uuid it has never seen.
  // ---------------------------------------------------------------------
  const [newQuestionIds, setNewQuestionIds] = useState<Set<string>>(() => new Set())
  const [newOptionIds, setNewOptionIds] = useState<Set<string>>(() => new Set())
  const [deletedQuestionIds, setDeletedQuestionIds] = useState<Set<string>>(() => new Set())
  const [deletedOptionIds, setDeletedOptionIds] = useState<Set<string>>(() => new Set())

  // Recomputed on every edit, so the reason a quiz cannot go live updates as
  // the operator fixes it rather than at save time.
  const gate = useMemo(() => quizGate(quiz), [quiz])

  function patchQuestion(id: string, patch: Partial<QuizQuestion>) {
    setQuiz((q) => ({ ...q, questions: q.questions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  }

  function patchOption(questionId: string, optionId: string, patch: Partial<QuizOption>) {
    setQuiz((q) => ({
      ...q,
      questions: q.questions.map((question) =>
        question.id !== questionId
          ? question
          : { ...question, options: question.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) },
      ),
    }))
  }

  /** A fresh id, minted here so the row can be rendered and referenced at once. */
  function mintId(): string {
    return globalThis.crypto.randomUUID()
  }

  function addQuestion() {
    const id = mintId()
    const options = [1, 2].map((position) => ({
      id: mintId(),
      questionId: id,
      position,
      label: `Option ${position}`,
      weight: 0,
      routesToBranchId: null,
      profileId: null,
    }))
    setQuiz((q) => ({
      ...q,
      questions: [
        ...q.questions,
        {
          id,
          quizId: q.id,
          // The group the owner is looking at. Adding to the shared set while
          // they are looking at a branch puts the question somewhere they did
          // not ask for and will not find.
          branchId: branchTab === EVERYONE ? null : branchTab,
          // POSITION IS GLOBAL ACROSS THE QUIZ, not per branch, so the max is
          // taken over every question rather than over the visible ones.
          position: q.questions.reduce((max, question) => Math.max(max, question.position), 0) + 10,
          // A PLACEHOLDER, NOT A BLANK. The save route requires a prompt of at
          // least one character — an empty one is refused, and it takes the
          // whole save down with it, including every unrelated edit the owner
          // made in the same sitting. Found by driving the real editor: the
          // first capture run got "Invalid save." and nothing else.
          prompt: "New question",
          helpText: null,
          // SWITCHED OFF. The walk skips inactive questions, so a half-typed
          // one cannot reach a visitor even while the quiz is live — and the
          // gate ignores it, so it cannot block an activation either.
          isActive: false,
          options,
        },
      ],
    }))
    setNewQuestionIds((ids) => new Set(ids).add(id))
    setNewOptionIds((ids) => {
      const next = new Set(ids)
      for (const option of options) next.add(option.id)
      return next
    })
  }

  function removeQuestion(questionId: string) {
    setQuiz((q) => ({ ...q, questions: q.questions.filter((question) => question.id !== questionId) }))
    setNewQuestionIds((ids) => {
      if (!ids.has(questionId)) {
        // It exists on the server, so the server has to be told.
        setDeletedQuestionIds((deleted) => new Set(deleted).add(questionId))
        return ids
      }
      const next = new Set(ids)
      next.delete(questionId)
      return next
    })
  }

  function addOption(questionId: string) {
    const id = mintId()
    setQuiz((q) => ({
      ...q,
      questions: q.questions.map((question) =>
        question.id !== questionId
          ? question
          : {
              ...question,
              options: [
                ...question.options,
                {
                  id,
                  questionId,
                  position: question.options.reduce((max, option) => Math.max(max, option.position), 0) + 1,
                  label: "New answer",
                  weight: 0,
                  routesToBranchId: null,
                  profileId: null,
                },
              ],
            },
      ),
    }))
    setNewOptionIds((ids) => new Set(ids).add(id))
  }

  function removeOption(questionId: string, optionId: string) {
    setQuiz((q) => ({
      ...q,
      questions: q.questions.map((question) =>
        question.id !== questionId
          ? question
          : { ...question, options: question.options.filter((option) => option.id !== optionId) },
      ),
    }))
    setNewOptionIds((ids) => {
      if (!ids.has(optionId)) {
        setDeletedOptionIds((deleted) => new Set(deleted).add(optionId))
        return ids
      }
      const next = new Set(ids)
      next.delete(optionId)
      return next
    })
  }

  /**
   * Reorder by SWAPPING POSITIONS with the neighbour, not by splicing an array.
   *
   * `position` is global across the quiz and is what the walk sorts on, so the
   * thing that has to change is the number itself — an array order that is not
   * written back is a reorder the visitor never sees.
   *
   * Buttons rather than drag: the plan suggested @dnd-kit "matching the funnel
   * step builder", but the funnel step builder does not use it, and a drag
   * handle is keyboard-hostile and effectively untestable in jsdom. These are
   * operable by keyboard for free and the reorder is asserted directly.
   */
  function move(questionId: string, direction: -1 | 1) {
    setQuiz((q) => {
      const siblings = q.questions
        .filter((x) => (branchTab === EVERYONE ? x.branchId === null : x.branchId === branchTab))
        .slice()
        .sort((a, b) => a.position - b.position)
      const i = siblings.findIndex((x) => x.id === questionId)
      const j = i + direction
      if (i < 0 || j < 0 || j >= siblings.length) return q
      const a = siblings[i]
      const b = siblings[j]
      return {
        ...q,
        questions: q.questions.map((x) =>
          x.id === a.id ? { ...x, position: b.position } : x.id === b.id ? { ...x, position: a.position } : x,
        ),
      }
    })
  }

  async function save(nextStatus?: QuizDefinition["status"]) {
    setBusy(true)
    setMessage(null)
    setServerBlockers(null)
    try {
      const res = await fetch(`/api/admin/quizzes/${quiz.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quiz: {
            name: quiz.name,
            introHeadline: quiz.introHeadline,
            introBody: quiz.introBody,
            gateHeadline: quiz.gateHeadline,
            gateBody: quiz.gateBody,
            resultHeadline: quiz.resultHeadline,
            ...(nextStatus ? { status: nextStatus } : {}),
          },
          // EXISTING ROWS ONLY in the update lists. A new row is carried by
          // `addQuestions` / `addOptions` with its final values already on it,
          // so sending it here as well would ask the server to update a row it
          // has only just inserted.
          questions: quiz.questions
            .filter((q) => !newQuestionIds.has(q.id))
            .map((q) => ({
              id: q.id,
              position: q.position,
              prompt: q.prompt,
              helpText: q.helpText,
              isActive: q.isActive,
            })),
          options: quiz.questions.flatMap((q) =>
            q.options
              .filter((o) => !newOptionIds.has(o.id))
              .map((o) => ({
                id: o.id,
                label: o.label,
                weight: o.weight,
                routesToBranchId: o.routesToBranchId,
                profileId: o.profileId,
              })),
          ),
          addQuestions: quiz.questions
            .filter((q) => newQuestionIds.has(q.id))
            .map((q) => ({
              id: q.id,
              branchId: q.branchId,
              position: q.position,
              prompt: q.prompt,
              helpText: q.helpText,
              isActive: q.isActive,
              options: q.options.map((o) => ({
                id: o.id,
                position: o.position,
                label: o.label,
                weight: o.weight,
                routesToBranchId: o.routesToBranchId,
                profileId: o.profileId,
              })),
            })),
          // A new option on an EXISTING question. One on a new question travels
          // inside `addQuestions` above, and sending it twice would insert it
          // twice.
          addOptions: quiz.questions
            .filter((q) => !newQuestionIds.has(q.id))
            .flatMap((q) =>
              q.options
                .filter((o) => newOptionIds.has(o.id))
                .map((o) => ({
                  id: o.id,
                  questionId: q.id,
                  position: o.position,
                  label: o.label,
                  weight: o.weight,
                  routesToBranchId: o.routesToBranchId,
                  profileId: o.profileId,
                })),
            ),
          deleteQuestionIds: [...deletedQuestionIds],
          deleteOptionIds: [...deletedOptionIds],
          tiers: quiz.tiers.map((t) => ({
            id: t.id,
            minScore: t.minScore,
            maxScore: t.maxScore,
            headline: t.headline,
            body: t.body,
          })),
          profiles: quiz.profiles.map((p) => ({ id: p.id, name: p.name, description: p.description, position: p.position })),
          branches: quiz.branches.map((b) => ({ id: b.id, name: b.name, description: b.description, position: b.position })),
        }),
      })
      const json = (await res.json()) as { blockers?: string[]; error?: string }
      if (!res.ok) {
        // The route's own blockers, shown verbatim. It gates the quiz AS SAVED,
        // so it can refuse something this browser thought was fine.
        setServerBlockers(json.blockers ?? null)
        setMessage(json.error ?? "Could not save.")
        return
      }
      // ADOPT WHAT THE SERVER SENT BACK, rather than keeping local state. It
      // is the editor's own read, so it carries the questions this save just
      // retired — which local state cannot know about, having asked for a
      // delete. Falling back to local state keeps a save working against an
      // older server that does not return it.
      const saved = json as {
        quiz?: QuizDefinition
        retiredQuestionIds?: string[]
        deactivated?: boolean
        blockers?: string[]
      }
      if (saved.quiz) setQuiz(saved.quiz)
      else if (nextStatus) setQuiz((q) => ({ ...q, status: nextStatus }))

      // THE PENDING SETS ARE CLEARED ONLY ON SUCCESS. On a refusal they stay,
      // so the owner sees the reason AND still has the change they made —
      // clearing them would silently revert the edit and make the next save a
      // no-op nobody could explain.
      setNewQuestionIds(new Set())
      setNewOptionIds(new Set())
      setDeletedQuestionIds(new Set())
      setDeletedOptionIds(new Set())

      // TAKEN OFFLINE BY THIS EDIT. Said first and said plainly, because it is
      // the only outcome here that changes what visitors see, and the blockers
      // are shown alongside so the way back is on the same screen.
      if (saved.deactivated) {
        setServerBlockers(saved.blockers ?? null)
        setMessage(
          "Saved — but this change means the quiz can no longer be scored, so it has been taken offline. Nobody is being shown it. Fix the points below and choose Activate to put it back.",
        )
        return
      }

      const retired = saved.retiredQuestionIds ?? []
      setMessage(
        retired.length === 0
          ? "Saved."
          : retired.length === 1
            ? "Saved. That question has answers, so it was retired rather than removed — nobody is shown it any more, and the results people already got are kept."
            : `Saved. ${retired.length} of those questions have answers, so they were retired rather than removed — nobody is shown them any more, and the results people already got are kept.`,
      )
      router.refresh()
    } catch {
      setMessage("Could not save.")
    } finally {
      setBusy(false)
    }
  }

  const questionsInGroup = quiz.questions
    .filter((q) => (branchTab === EVERYONE ? q.branchId === null : q.branchId === branchTab))
    .slice()
    .sort((a, b) => a.position - b.position)

  // NOT LIVE YET AND RETIRED ARE BOTH INACTIVE, AND THEY ARE NOT THE SAME
  // THING. A question just added is switched off so a half-typed one cannot
  // reach a visitor — it belongs with the questions the owner is working on. A
  // question the server retired is switched off because somebody has already
  // answered it, and it belongs out of the way.
  //
  // Sorting only on `isActive` puts a brand new question in a group headed
  // "Retired", which is both wrong and alarming.
  const visibleQuestions = questionsInGroup.filter((q) => q.isActive || newQuestionIds.has(q.id))
  const retiredQuestions = questionsInGroup.filter((q) => !q.isActive && !newQuestionIds.has(q.id))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{quiz.name}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{quiz.key}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface/50 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void save("active")}
            disabled={busy || !gate.ok || quiz.status === "active"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {quiz.status === "active" ? "Active" : "Activate"}
          </button>
        </div>
      </header>

      {quiz.seedMarker ? (
        <div className="rounded-lg border border-border bg-warning/10 px-4 py-3 text-sm">
          <strong className="font-semibold">This quiz still carries reconstructed scoring.</strong> The weights and tier
          cutoffs were rebuilt from GoHighLevel field metadata, not recovered — the original workflows exported without
          them. Review them before trusting a result.
        </div>
      ) : null}

      {/* THE REASON, NOT A SILENT DISABLE.
          AND IT SAYS SOMETHING DIFFERENT WHEN THE QUIZ IS ALREADY LIVE.
          Found by looking at a screenshot: the editor showed "Active" and
          "cannot be activated yet" side by side, which reads as a
          contradiction and buries the thing that actually matters. Editing is
          deliberately NOT blocked on a live quiz — that would make a broken
          one impossible to repair — so the only protection is saying plainly
          that this one is serving visitors right now and would fail them. */}
      {!gate.ok ? (
        <div className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm">
          <p className="font-semibold">
            {quiz.status === "active"
              ? "This quiz is LIVE and these changes would break it for visitors:"
              : "This quiz cannot be activated yet:"}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {gate.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {gate.warnings.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface/50 px-4 py-3 text-sm">
          <p className="font-semibold">Worth a look:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {gate.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {serverBlockers ? (
        <div className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm">
          <p className="font-semibold">The server refused this activation:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {serverBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Editor panels">
        {PANELS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPanel(p.key)}
            aria-current={panel === p.key ? "page" : undefined}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              panel === p.key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {panel === "details" ? (
        <section className="space-y-3">
          <Field label="Name" value={quiz.name} onChange={(v) => setQuiz((q) => ({ ...q, name: v }))} />
          <Field label="Intro headline" value={quiz.introHeadline} onChange={(v) => setQuiz((q) => ({ ...q, introHeadline: v }))} />
          <Field label="Intro body" value={quiz.introBody} onChange={(v) => setQuiz((q) => ({ ...q, introBody: v }))} />
          <Field label="Gate headline" value={quiz.gateHeadline} onChange={(v) => setQuiz((q) => ({ ...q, gateHeadline: v }))} />
          <Field label="Gate body" value={quiz.gateBody} onChange={(v) => setQuiz((q) => ({ ...q, gateBody: v }))} />
          <Field label="Result headline" value={quiz.resultHeadline} onChange={(v) => setQuiz((q) => ({ ...q, resultHeadline: v }))} />
        </section>
      ) : null}

      {panel === "branches" ? (
        <section className="space-y-3">
          {quiz.branches.map((branch) => (
            <div key={branch.id} className="rounded-lg border border-border p-4">
              <p className="font-mono text-xs text-muted-foreground">{branch.key}</p>
              <Field
                label="Name"
                value={branch.name}
                onChange={(v) =>
                  setQuiz((q) => ({ ...q, branches: q.branches.map((b) => (b.id === branch.id ? { ...b, name: v } : b)) }))
                }
              />
            </div>
          ))}
        </section>
      ) : null}

      {panel === "questions" ? (
        <section className="space-y-4">
          {/* A TAB PER BRANCH, PLUS "Everyone" — which is where the router and
              the shared segmentation questions live. Without it those would be
              unreachable in the editor, because they belong to no branch. */}
          <nav className="flex flex-wrap gap-1" aria-label="Question groups">
            {[{ id: EVERYONE, name: "Everyone" }, ...quiz.branches.map((b) => ({ id: b.id, name: b.name }))].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setBranchTab(tab.id)}
                aria-current={branchTab === tab.id ? "true" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  branchTab === tab.id ? "bg-primary text-white" : "border border-border text-muted-foreground"
                }`}
              >
                {tab.name}
              </button>
            ))}
          </nav>

          <div data-testid="live-questions" className="space-y-4">
          {visibleQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions in this group.</p>
          ) : (
            visibleQuestions.map((question, index) => (
              <div key={question.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Field
                      label={question.isActive ? `Question ${index + 1}` : `Question ${index + 1} — not live yet`}
                      value={question.prompt}
                      onChange={(v) => patchQuestion(question.id, { prompt: v })}
                    />
                    {!question.isActive ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nobody taking the quiz sees this yet. Write it, then choose &ldquo;Turn it
                        on&rdquo;.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1 pt-6">
                    <button
                      type="button"
                      aria-label={`Move "${question.prompt}" earlier`}
                      disabled={index === 0}
                      onClick={() => move(question.id, -1)}
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move "${question.prompt}" later`}
                      disabled={index === visibleQuestions.length - 1}
                      onClick={() => move(question.id, 1)}
                      className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↓
                    </button>
                    {!question.isActive ? (
                      <button
                        type="button"
                        aria-label={`Turn this question on: "${question.prompt}"`}
                        onClick={() => patchQuestion(question.id, { isActive: true })}
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-surface/50"
                      >
                        Turn it on
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Turn this question off: "${question.prompt}"`}
                        onClick={() => patchQuestion(question.id, { isActive: false })}
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-surface/50"
                      >
                        Turn it off
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove this question: "${question.prompt}"`}
                      onClick={() => removeQuestion(question.id)}
                      className="rounded border border-border px-2 py-1 text-xs text-error hover:bg-surface/50"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-xs font-medium text-muted-foreground">Options</p>
                <ul className="mt-1 space-y-2">
                  {question.options.map((option) => (
                    <li key={option.id} className="grid gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_5rem_9rem_9rem]">
                      <input
                        aria-label={`Label for ${option.label}`}
                        className="rounded border border-border px-2 py-1 text-sm"
                        value={option.label}
                        onChange={(e) => patchOption(question.id, option.id, { label: e.target.value })}
                      />
                      <input
                        aria-label={`Weight for ${option.label}`}
                        type="number"
                        min={0}
                        className="rounded border border-border px-2 py-1 text-sm"
                        value={option.weight}
                        onChange={(e) => patchOption(question.id, option.id, { weight: Number(e.target.value) })}
                      />
                      <select
                        aria-label={`Routes to for ${option.label}`}
                        className="rounded border border-border px-2 py-1 text-sm"
                        value={option.routesToBranchId ?? ""}
                        onChange={(e) =>
                          patchOption(question.id, option.id, { routesToBranchId: e.target.value || null })
                        }
                      >
                        <option value="">No branch</option>
                        {quiz.branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Profile vote for ${option.label}`}
                        className="rounded border border-border px-2 py-1 text-sm"
                        value={option.profileId ?? ""}
                        onChange={(e) => patchOption(question.id, option.id, { profileId: e.target.value || null })}
                      >
                        <option value="">No vote</option>
                        {quiz.profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove this answer: "${option.label}"`}
                        onClick={() => removeOption(question.id, option.id)}
                        className="justify-self-start rounded border border-border px-2 py-1 text-xs text-error hover:bg-surface/50 sm:col-span-4"
                      >
                        Remove this answer
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-label={`Add an answer to "${question.prompt}"`}
                  onClick={() => addOption(question.id)}
                  className="mt-2 rounded border border-border px-3 py-1.5 text-xs hover:bg-surface/50"
                >
                  Add an answer
                </button>
              </div>
            ))
          )}
          </div>

          <button
            type="button"
            onClick={addQuestion}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface/50"
          >
            Add a question
          </button>
          <p className="text-xs text-muted-foreground">
            A new question starts switched off, so nobody taking the quiz sees it until you choose
            &ldquo;Turn it on&rdquo;. That way a half-written question can never reach somebody
            part-way through.
          </p>

          {retiredQuestions.length > 0 ? (
            <section data-testid="retired-questions" className="space-y-2 rounded-lg border border-dashed border-border p-4">
              <h2 className="text-sm font-medium text-muted-foreground">Retired</h2>
              <p className="text-xs text-muted-foreground">
                People have already answered these, so their wording is kept for your reports. Nobody
                taking the quiz is shown them.
              </p>
              {retiredQuestions.map((question) => (
                <div key={question.id} className="flex items-center justify-between gap-3 rounded border border-border p-3">
                  <span className="text-sm">{question.prompt}</span>
                  <button
                    type="button"
                    aria-label={`Bring this question back: "${question.prompt}"`}
                    onClick={() => patchQuestion(question.id, { isActive: true })}
                    className="shrink-0 rounded border border-border px-3 py-1.5 text-xs hover:bg-surface/50"
                  >
                    Bring it back
                  </button>
                </div>
              ))}
            </section>
          ) : null}
        </section>
      ) : null}

      {panel === "tiers" ? (
        <section className="space-y-3">
          {quiz.tiers
            .slice()
            .sort((a, b) => a.minScore - b.minScore)
            .map((tier) => (
              <div key={tier.id} className="grid gap-2 rounded-lg border border-border p-4 sm:grid-cols-[6rem_6rem_1fr]">
                <NumberField
                  label={`${tier.key} from`}
                  value={tier.minScore}
                  onChange={(v) =>
                    setQuiz((q) => ({ ...q, tiers: q.tiers.map((t) => (t.id === tier.id ? { ...t, minScore: v } : t)) }))
                  }
                />
                <NumberField
                  label={`${tier.key} to`}
                  value={tier.maxScore}
                  onChange={(v) =>
                    setQuiz((q) => ({ ...q, tiers: q.tiers.map((t) => (t.id === tier.id ? { ...t, maxScore: v } : t)) }))
                  }
                />
                <Field
                  label={`${tier.key} headline`}
                  value={tier.headline}
                  onChange={(v) =>
                    setQuiz((q) => ({ ...q, tiers: q.tiers.map((t) => (t.id === tier.id ? { ...t, headline: v } : t)) }))
                  }
                />
              </div>
            ))}
        </section>
      ) : null}

      {panel === "profiles" ? (
        <section className="space-y-3">
          {quiz.profiles
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((profile) => (
              <div key={profile.id} className="rounded-lg border border-border p-4">
                <p className="font-mono text-xs text-muted-foreground">
                  {profile.key}
                  {profile.position === 0 ? " — the no-vote fallback" : ""}
                </p>
                <Field
                  label="Name"
                  value={profile.name}
                  onChange={(v) =>
                    setQuiz((q) => ({ ...q, profiles: q.profiles.map((p) => (p.id === profile.id ? { ...p, name: v } : p)) }))
                  }
                />
                <Field
                  label="Description"
                  value={profile.description}
                  onChange={(v) =>
                    setQuiz((q) => ({
                      ...q,
                      profiles: q.profiles.map((p) => (p.id === profile.id ? { ...p, description: v } : p)),
                    }))
                  }
                />
              </div>
            ))}
        </section>
      ) : null}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block w-full">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        className="w-full rounded border border-border px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block w-full">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        className="w-full rounded border border-border px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
