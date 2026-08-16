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
import { Plus } from "lucide-react"
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
import { RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"
import { StepPlanEditor, stepPlanErrors, type PlannedStep } from "./StepPlanEditor"

interface Offer {
  id: string
  name: string
}

const DEFAULT_TEMPLATE = FUNNEL_TEMPLATES[0]

function planOf(template: FunnelTemplate): PlannedStep[] {
  return template.steps.map((step) => ({ ...step }))
}

export function CreateFunnelDialog({ takenSlugs }: { takenSlugs: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
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
  const [offersError, setOffersError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const template = getTemplate(templateId) ?? DEFAULT_TEMPLATE
  const asks = (ask: "audience" | "offer" | "dates" | "notify") =>
    (template.asks as readonly string[]).includes(ask)

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
        }),
      })
      const body = (await response.json()) as {
        funnel?: { id: string }
        entryStepId?: string
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
        body.entryStepId
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
              placeholder="Registration flow for the summer camp: signup, payment, confirmation."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Used to write the first draft of every step, so the more you say the closer
              they land.
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
    </Dialog>
  )
}
