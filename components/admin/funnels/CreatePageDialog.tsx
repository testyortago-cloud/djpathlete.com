"use client"

// Creating a landing page used to be a name and a button, which is all a
// combined page/funnel concept could honestly ask for. Now that a page is its
// own thing, the dialog can ask the two questions that actually shape it —
// what it is for, and what it should say — and hand both to the builder so the
// page starts writing itself instead of opening blank.

import { useMemo, useState } from "react"
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
import { FUNNEL_GOALS, RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"
import type { FunnelGoal } from "@/types/database"

interface CreatePageDialogProps {
  /** Slugs already taken, for the inline hint. The server 409 stays authoritative. */
  takenSlugs: string[]
}

export function CreatePageDialog({ takenSlugs }: CreatePageDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [goal, setGoal] = useState<FunnelGoal>("leads")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  // Derived until the owner takes the wheel. Re-deriving after that would throw
  // away a URL they chose deliberately.
  const effectiveSlug = slugTouched ? slug : slugify(name)

  // Every rule here comes from the validator. A second copy of the reserved
  // list or the pattern would drift, and the owner would meet the difference as
  // a 400 after the dialog told them everything was fine.
  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    if (RESERVED_FUNNEL_SLUGS.has(effectiveSlug)) return "That address is reserved — pick another."
    if (takenSlugs.includes(effectiveSlug)) return "That address is already in use."
    return null
  }, [effectiveSlug, takenSlugs])

  const canSubmit = name.trim().length >= 2 && effectiveSlug.length >= 2 && slugError === null && !creating

  function reset() {
    setName("")
    setSlug("")
    setSlugTouched(false)
    setGoal("leads")
    setDescription("")
  }

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          kind: "page",
          goal,
          description: description.trim() === "" ? null : description.trim(),
        }),
      })
      const body = (await response.json()) as {
        funnel?: { id: string }
        entryStepId?: string
        error?: string
      }
      if (!response.ok || !body.funnel) {
        // Stay open. Everything typed is still here, and closing would lose it.
        toast.error(body.error ?? "Could not create the page.")
        return
      }
      toast.success("Landing page created.")
      setOpen(false)
      reset()
      // Straight into the builder. `start=1` is only a nudge — the builder's own
      // guard (empty document, no turns) decides whether the first prompt fires.
      router.push(
        body.entryStepId
          ? `/admin/pages/${body.funnel.id}/edit/${body.entryStepId}?start=1`
          : `/admin/pages/${body.funnel.id}`,
      )
    } catch {
      toast.error("Could not create the page.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New landing page
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New landing page</DialogTitle>
          <DialogDescription>
            One focused page with one job. Answer these and the builder writes the first draft for you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="page-name">Name</Label>
            <Input
              id="page-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Free Trial Week"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Only you see this — it labels the page in this list.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="page-slug">URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/</span>
              <Input
                id="page-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="free-trial-week"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Visitors will land on <span className="font-mono">/go/{effectiveSlug || "…"}</span>
              </p>
            )}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">What should this page do?</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {FUNNEL_GOALS.map((option) => {
                const active = goal === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={option.label}
                    onClick={() => setGoal(option.value)}
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

          <div className="space-y-1.5">
            <Label htmlFor="page-description">Describe it</Label>
            <Textarea
              id="page-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A page for high-school athletes considering a first training block."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Optional. This becomes the builder&rsquo;s first instruction, so the more you say the closer the
              first draft lands.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating ? "Creating…" : "Create & build"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
