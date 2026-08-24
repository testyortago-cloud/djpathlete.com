"use client"

// Creating a funnel used to ask for a name, a URL and a description, then drop
// the owner on a list holding one card called "Step 1". The description's own
// placeholder said "signup, payment, confirmation" — the owner had already
// enumerated their three steps and the app made them add three steps by hand,
// while storing that sentence in a column nothing on the funnel path ever read.
//
// THIS DIALOG REVERSES A DELIBERATE DECISION, so the reasoning is worth
// recording. The old version was plainer than `CreatePageDialog` on purpose: "a
// funnel is a container: the interesting questions belong to its steps, and
// asking them here would store a goal for something that does not have one."
// That reasoning is right and this design keeps it. What did not follow was the
// conclusion. The questions DO belong to the steps — so creation asks them PER
// STEP, via a template that knows what the steps are. No goal is stored on the
// funnel; goals are stored on the rows that have them.
//
// The conditional intake below is not politeness. A template's `asks` array
// decides which fields render here AND which fields `createFunnelSchema`
// accepts, so a field this dialog hides is a field the server refuses.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BookOpen, Plus, Sparkles } from "lucide-react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { slugify } from "@/lib/funnels/slug"
import { FUNNEL_TEMPLATES, getTemplate, type FunnelTemplate } from "@/lib/funnels/templates"
import { BUILTIN_QUIZ_SOURCE, BUILTIN_QUIZ_LABEL } from "@/lib/quizzes/sources"
import { RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"
import type { CreatePlan } from "@/lib/funnels/ai-plan"
import { StepPlanEditor, stepPlanErrors, type PlannedStep } from "./StepPlanEditor"
import { AskAiDialog } from "./AskAiDialog"
import { ExamplesDialog, type OwnExample } from "./ExamplesDialog"

interface Offer {
  id: string
  name: string
}

const DEFAULT_TEMPLATE = FUNNEL_TEMPLATES[0]

function planOf(template: FunnelTemplate): PlannedStep[] {
  return template.steps.map((step) => ({ ...step }))
}

export function CreateFunnelDialog({
  takenSlugs,
  ownExamples = [],
}: {
  takenSlugs: string[]
  /** The owner's own funnels, for the examples modal. Derived by the board. */
  ownExamples?: OwnExample[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [askAiOpen, setAskAiOpen] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE.value)
  const [steps, setSteps] = useState<PlannedStep[]>(planOf(DEFAULT_TEMPLATE))
  const [audience, setAudience] = useState("")
  const [offerRef, setOfferRef] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [autoOffline, setAutoOffline] = useState(false)
  const [notify, setNotify] = useState("")
  const [offers, setOffers] = useState<Offer[]>([])
  const [quizSource, setQuizSource] = useState<string>(BUILTIN_QUIZ_SOURCE)
  const [quizzes, setQuizzes] = useState<{ id: string; name: string }[]>([])
  const [offersError, setOffersError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const template = getTemplate(templateId) ?? DEFAULT_TEMPLATE
  const asks = (ask: "audience" | "offer" | "dates" | "notify" | "quiz") =>
    (template.asks as readonly string[]).includes(ask)

  const asksQuiz = asks("quiz")

  /**
   * THE BUILT-IN IS ALWAYS FIRST, and it is not one of the fetched rows.
   *
   * Building this list from the fetched quizzes alone would leave the picker
   * empty on any database that has no quizzes — which is every database before
   * the seed script has been run — and "Run a quiz" would be a template nobody
   * could use until they opened a terminal.
   */
  const quizSources = useMemo(
    () => [
      { value: BUILTIN_QUIZ_SOURCE, label: BUILTIN_QUIZ_LABEL },
      ...quizzes.map((quiz) => ({ value: quiz.id, label: `Copy of ${quiz.name}` })),
    ],
    [quizzes],
  )

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    if (RESERVED_FUNNEL_SLUGS.has(effectiveSlug)) return "That address is reserved — pick another."
    if (takenSlugs.includes(effectiveSlug)) return "That address is already in use."
    return null
  }, [effectiveSlug, takenSlugs])

  // The offer list is fetched per catalogue, and ONLY for a template that asks.
  // A `leads` funnel must not spend a request on a picker it will not render.
  useEffect(() => {
    if (!open || !template.offerKind) {
      setOffers([])
      setOffersError(null)
      return
    }
    let cancelled = false
    setOffersError(null)
    fetch(`/api/admin/funnels/offers?kind=${template.offerKind}`)
      .then(async (response) => {
        const body = (await response.json()) as { offers?: Offer[]; error?: string }
        if (cancelled) return
        if (!response.ok || !body.offers) {
          // Not fatal. The funnel can be created without a linked offer and the
          // CTA wired up later, so this reports and steps aside.
          setOffersError(body.error ?? "Could not load your offers.")
          setOffers([])
          return
        }
        setOffers(body.offers)
      })
      .catch(() => {
        if (!cancelled) setOffersError("Could not load your offers.")
      })
    return () => {
      cancelled = true
    }
  }, [open, template.offerKind])

  // The quiz list, and ONLY for a template that asks — same rule as the offer
  // picker above. A `leads` funnel must not spend a request on a control it
  // will not render.
  //
  // A FAILED FETCH IS NOT FATAL HERE, because the built-in is not in this list:
  // it is a sentinel the picker always offers, so the control still works and
  // the owner can still create a quiz funnel from the original.
  useEffect(() => {
    if (!open || !asksQuiz) {
      setQuizzes([])
      return
    }
    let cancelled = false
    fetch("/api/admin/quizzes")
      .then(async (response) => {
        const body = (await response.json()) as { quizzes?: { id: string; name: string }[] }
        if (cancelled) return
        setQuizzes(response.ok && body.quizzes ? body.quizzes : [])
      })
      .catch(() => {
        if (!cancelled) setQuizzes([])
      })
    return () => {
      cancelled = true
    }
  }, [open, asksQuiz])

  function selectTemplate(next: FunnelTemplate) {
    setTemplateId(next.value)
    setSteps(planOf(next))
    // Clear what the new template will not ask for, so a field the owner filled
    // in and then hid cannot be posted — the server would refuse it, and the
    // refusal would name a field no longer on screen.
    const nextAsks = next.asks as readonly string[]
    if (!nextAsks.includes("offer")) setOfferRef("")
    if (!nextAsks.includes("dates")) {
      setStartsAt("")
      setEndsAt("")
      setAutoOffline(false)
    }
    if (!nextAsks.includes("notify")) setNotify("")
    if (!nextAsks.includes("audience")) setAudience("")
  }

  /**
   * THE ONE WAY ANYTHING WRITES TO THESE FIELDS.
   *
   * Ask AI and the examples modal both land here rather than each poking at
   * state, so "what can change the dialog without the owner typing" has exactly
   * one answer — and a field added to the dialog has one place to be handled.
   *
   * It sets the slug and marks it TOUCHED, so a name applied here does not get
   * silently re-derived over on the next keystroke; and it re-runs the same
   * clearing `selectTemplate` does, because an applied plan changes the
   * template and must not leave a hidden field behind it.
   */
  function applyPlan(plan: CreatePlan) {
    // Narrowed, not cast. The dialogs are shared with the pages screen, so a
    // page plan reaching here is a wiring mistake — and silently applying half
    // of it would be worse than doing nothing.
    if (plan.kind !== "funnel") return
    const template = getTemplate(plan.template) ?? DEFAULT_TEMPLATE
    setTemplateId(template.value)
    setSteps(plan.steps.map((step) => ({ ...step })))

    if (plan.name) {
      setName(plan.name)
      setSlug(slugify(plan.name))
      setSlugTouched(true)
    }

    const nextAsks = template.asks as readonly string[]
    setAudience(nextAsks.includes("audience") ? (plan.audience ?? "") : "")
    setOfferRef(nextAsks.includes("offer") ? (plan.offer?.ref ?? "") : "")
    if (nextAsks.includes("dates")) {
      setStartsAt(plan.startsAt ? plan.startsAt.slice(0, 10) : "")
      setEndsAt(plan.endsAt ? plan.endsAt.slice(0, 10) : "")
    } else {
      setStartsAt("")
      setEndsAt("")
      setAutoOffline(false)
    }
    if (!nextAsks.includes("notify")) setNotify("")
    if (plan.description) setDescription(plan.description)
  }

  const stepErrors = stepPlanErrors(steps)
  const windowError =
    startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)
      ? "The end must come after the start."
      : null

  const canSubmit =
    name.trim().length >= 2 &&
    effectiveSlug.length >= 2 &&
    slugError === null &&
    windowError === null &&
    stepErrors.every((error) => error === null) &&
    !creating

  function reset() {
    setName("")
    setSlug("")
    setSlugTouched(false)
    setDescription("")
    setTemplateId(DEFAULT_TEMPLATE.value)
    setSteps(planOf(DEFAULT_TEMPLATE))
    setAudience("")
    setOfferRef("")
    setStartsAt("")
    setEndsAt("")
    setAutoOffline(false)
    setNotify("")
  }

  /** `2026-06-01` from a date input → the ISO instant the schema wants. */
  function asInstant(value: string): string | undefined {
    if (!value) return undefined
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const recipients = notify
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)

      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          kind: "funnel",
          description: description.trim() === "" ? null : description.trim(),
          template: template.value,
          // The PLAN as it stands, not the template id — the owner may have
          // renamed, reordered or removed rows, and posting the id would
          // silently discard every one of those edits.
          steps: steps.map((step) => ({
            name: step.name.trim(),
            slug: step.slug,
            goal: step.goal,
          })),
          ...(asks("audience") && audience.trim() ? { audience: audience.trim() } : {}),
          ...(asks("offer") && offerRef && template.offerKind
            ? { offer: { kind: template.offerKind, ref: offerRef } }
            : {}),
          ...(asks("dates") && asInstant(startsAt) ? { starts_at: asInstant(startsAt) } : {}),
          ...(asks("dates") && asInstant(endsAt) ? { ends_at: asInstant(endsAt) } : {}),
          ...(asks("dates") && autoOffline ? { auto_offline_at_end: true } : {}),
          ...(asks("notify") && recipients.length ? { notify_emails: recipients } : {}),
          // Sent ONLY when the template asks. The server refuses a quiz on a
          // template that has none, and refuses the quiz template without one.
          ...(asksQuiz ? { quiz: { copyFrom: quizSource } } : {}),
        }),
      })
      const body = (await response.json()) as {
        funnel?: { id: string }
        entryStepId?: string
        /** Present only for the quiz template. See below. */
        quizId?: string
        error?: string
      }
      if (!response.ok || !body.funnel) {
        // Stay open. Everything typed is still here, and closing would lose a
        // whole step plan rather than one field.
        toast.error(body.error ?? "Could not create the funnel.")
        return
      }
      toast.success("Funnel created.")
      setOpen(false)
      reset()
      // STRAIGHT INTO THE BUILDER, not the step list. The list used to be the
      // right destination because the owner had not yet decided what the
      // sequence was; with a template they have, and the list would only show
      // them what they just typed. Steps 2..N draft themselves when opened.
      router.push(
        // A QUIZ FUNNEL GOES TO THE QUIZ, NOT THE PAGE BUILDER. Its page is
        // already written — hero, quiz, footer — so the builder has nothing to
        // do that matters, while every question on it is still somebody else's
        // words. (`?start=1` would be harmless either way: the auto-draft guard
        // is `draft.doc === null`, and this step has a document.)
        body.quizId
          ? `/admin/funnels/quizzes/${body.quizId}`
          : body.entryStepId
          ? `/admin/funnels/${body.funnel.id}/edit/${body.entryStepId}?start=1`
          : `/admin/funnels/${body.funnel.id}`,
      )
    } catch {
      toast.error("Could not create the funnel.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New funnel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New funnel</DialogTitle>
          <DialogDescription>
            A sequence of steps sharing one address. Pick what it is for and the steps come with it —
            you can change them here before anything is created.
          </DialogDescription>
        </DialogHeader>

        {/* Above the fields, because its whole purpose is to answer "what do I
            type here" — offered after the first field it would be advice
            arriving too late to take. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-surface/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">Not sure where to start?</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setExamplesOpen(true)}>
            <BookOpen className="size-3.5" />
            See examples
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAskAiOpen(true)}>
            <Sparkles className="size-3.5" />
            Ask AI
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="funnel-name">Name</Label>
            <Input
              id="funnel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Summer Camp 2026"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="funnel-slug">URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/</span>
              <Input
                id="funnel-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="summer-camp-2026"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Every step lives under <span className="font-mono">/go/{effectiveSlug || "…"}</span>
              </p>
            )}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">What kind of funnel?</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {FUNNEL_TEMPLATES.map((option) => {
                const active = option.value === template.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={option.label}
                    onClick={() => selectTemplate(option)}
                    className={
                      active
                        ? "rounded-lg border border-primary bg-primary/5 p-3 text-left"
                        : "rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40"
                    }
                  >
                    <span className="block text-sm font-medium text-primary">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <StepPlanEditor funnelSlug={effectiveSlug} steps={steps} onChange={setSteps} />

          {asks("offer") ? (
            <div className="space-y-1.5">
              <Label htmlFor="funnel-offer">Which one?</Label>
              <select
                id="funnel-offer"
                value={offerRef}
                onChange={(event) => setOfferRef(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm"
              >
                <option value="">Choose later</option>
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.name}>
                    {offer.name}
                  </option>
                ))}
              </select>
              {offersError ? (
                <p className="text-xs text-muted-foreground">
                  {offersError} You can link it from the page itself later.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The checkout step points at this, so the first draft has something real to sell.
                </p>
              )}
            </div>
          ) : null}

          {asksQuiz ? (
            <div className="space-y-1.5">
              <Label htmlFor="funnel-quiz">Copy questions from</Label>
              <select
                id="funnel-quiz"
                value={quizSource}
                onChange={(event) => setQuizSource(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm"
              >
                {quizSources.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Your new quiz starts as a copy of this one. You can change every question, answer and
                score afterwards — the original is left alone.
              </p>
            </div>
          ) : null}

          {asks("dates") ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="funnel-starts">Runs from</Label>
                  <Input
                    id="funnel-starts"
                    type="date"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="funnel-ends">until</Label>
                  <Input
                    id="funnel-ends"
                    type="date"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </div>
              </div>
              {windowError ? <p className="text-xs text-[var(--error)]">{windowError}</p> : null}
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoOffline}
                  onChange={(event) => setAutoOffline(event.target.checked)}
                  className="mt-0.5"
                />
                {/* Says "when the run ends", not "automatically" — the job that
                    honours this is flag-gated and off by default, and the funnel
                    detail screen states plainly whether it is running. */}
                <span>Take the funnel offline when the run ends</span>
              </label>
            </div>
          ) : null}

          {asks("audience") ? (
            <div className="space-y-1.5">
              <Label htmlFor="funnel-audience">Who is this for?</Label>
              <Input
                id="funnel-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                placeholder="High-school tennis players and their parents"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Every step is written to this reader.
              </p>
            </div>
          ) : null}

          {asks("notify") ? (
            <div className="space-y-1.5">
              <Label htmlFor="funnel-notify">Email me new leads</Label>
              <Input
                id="funnel-notify"
                value={notify}
                onChange={(event) => setNotify(event.target.value)}
                placeholder="you@example.com"
              />
              <p className="text-xs text-muted-foreground">
                Optional, comma-separated. Leads always land in the inbox as well.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="funnel-description">Describe it</Label>
            <Textarea
              id="funnel-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                asksQuiz
                  ? "A short check for rotational athletes: how the body moves through a turn, not training history."
                  : "Registration flow for the summer camp: signup, payment, confirmation."
              }
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {asksQuiz
                ? // A QUIZ FUNNEL'S PAGE IS WRITTEN AT CREATION, so the usual sentence — "used to
                  // write the first draft of every step" — is simply false here. Saying it anyway
                  // teaches the owner that this field does something it does not.
                  "Optional. A note to yourself about who this quiz is for. The page is already written, so nothing is drafted from it."
                : "Optional. Used to write the first draft of every step, so the more you say the closer they land."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating ? "Creating…" : "Create funnel"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Siblings, not children of DialogContent: a Dialog nested inside another
          Dialog's content traps focus in the outer one and the inner modal
          cannot be typed into. */}
      <AskAiDialog open={askAiOpen} onOpenChange={setAskAiOpen} onApply={applyPlan} kind="funnel" />
      <ExamplesDialog
        open={examplesOpen}
        onOpenChange={setExamplesOpen}
        onApply={applyPlan}
        ownExamples={ownExamples}
        kind="funnel"
      />
    </Dialog>
  )
}
