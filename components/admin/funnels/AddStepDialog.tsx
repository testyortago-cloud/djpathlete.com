"use client"

// Adds a page to a funnel.
//
// POST /api/admin/funnels/steps has existed since 00202 with no caller, and its
// own comment says the funnel/step split is pointless without it. That was
// survivable while every funnel held exactly one page. It stopped being
// survivable once the funnels screen presented funnels as multi-step
// sequences the owner could grow — with no way in the UI to add the step.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"

interface AddStepDialogProps {
  funnelId: string
  /** The funnel's own slug — a step's address is this plus its own. */
  funnelSlug: string
  /** Step slugs already used in THIS funnel. Uniqueness is per funnel, not global. */
  takenSlugs: string[]
}

export function AddStepDialog({ funnelId, funnelSlug, takenSlugs }: AddStepDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [adding, setAdding] = useState(false)

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    // `index` is the entry step's slug, created alongside the funnel itself.
    // Without this the insert 409s on a constraint the owner cannot see.
    if (effectiveSlug === "index") return "That path belongs to the entry page."
    if (takenSlugs.includes(effectiveSlug)) return "That path is already used in this funnel."
    return null
  }, [effectiveSlug, takenSlugs])

  const canSubmit = name.trim().length >= 2 && effectiveSlug.length >= 2 && slugError === null && !adding

  async function handleAdd() {
    if (!canSubmit) return
    setAdding(true)
    try {
      const response = await fetch("/api/admin/funnels/steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnel_id: funnelId, name: name.trim(), slug: effectiveSlug }),
      })
      const body = (await response.json()) as { step?: { id: string }; error?: string }
      if (!response.ok || !body.step) {
        toast.error(body.error ?? "Could not add the step.")
        return
      }
      toast.success("Step added.")
      setOpen(false)
      setName("")
      setSlug("")
      setSlugTouched(false)
      router.refresh()
    } catch {
      toast.error("Could not add the step.")
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" />
          Add step
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a step</DialogTitle>
          <DialogDescription>
            A new page in this funnel — a thank-you, an upsell, a payment step. You&rsquo;ll build its
            content next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="step-name">Name</Label>
            <Input
              id="step-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Thank you"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="step-slug">Path</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/{funnelSlug}/</span>
              <Input
                id="step-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="thank-you"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Visitors reach it at{" "}
                <span className="font-mono">
                  /go/{funnelSlug}/{effectiveSlug || "…"}
                </span>
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={adding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canSubmit}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
