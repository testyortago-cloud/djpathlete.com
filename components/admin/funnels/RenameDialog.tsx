"use client"

// Renaming, from the card that shows the name.
//
// A name was settable exactly once — in the create dialog — and after that the
// only way to change it was to delete the page and build it again. Nothing
// about a name is permanent: it is the label the owner reads this list by.
//
// WHICH ROW OWNS THE NAME DEPENDS ON THE CARD, so the caller passes the
// endpoint rather than this dialog inferring it from a `kind`. A landing page's
// name lives on the `funnels` row (its only step is named "Landing page" by
// createFunnel and the owner never chose that); a funnel's page is a step with
// a name of its own. Both endpoints take `{ name }` — that is the whole reason
// one dialog can serve both.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pencil } from "lucide-react"
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
import { FUNNEL_NAME_MIN_LENGTH, FUNNEL_NAME_MAX_LENGTH } from "@/lib/validators/funnel"

export interface RenameDialogProps {
  /** The name as it stands. Seeds the field and names the trigger. */
  name: string
  /** PATCH target — the row that owns the title. Must accept `{ name }`. */
  endpoint: string
  /** What the owner calls this thing: "landing page", "page", "funnel". */
  noun: string
  /**
   * The public path, spelled out under the field. A rename that silently moved
   * the URL would break every link already handed out, so the dialog says
   * plainly that it does not — the URL is changed somewhere else, deliberately.
   */
  publicPath?: string
  /** Called with the saved name, for callers holding the row in local state. */
  onRenamed?: (name: string) => void
}

export function RenameDialog({ name, endpoint, noun, publicPath, onRenamed }: RenameDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)

  const trimmed = value.trim()
  const canSubmit =
    trimmed.length >= FUNNEL_NAME_MIN_LENGTH && trimmed.length <= FUNNEL_NAME_MAX_LENGTH && !saving

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    // Nothing to send, and a no-op PATCH would still write an audit row.
    if (trimmed === name) {
      setOpen(false)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        // Stay open, holding what was typed.
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        toast.error(body?.error ?? "Could not rename.")
        return
      }
      toast.success("Renamed.")
      setOpen(false)
      onRenamed?.(trimmed)
      router.refresh()
    } catch {
      toast.error("Could not rename.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-seed on OPEN, not on close: an abandoned edit must not be waiting
        // in the field the next time the dialog is opened.
        if (next) setValue(name)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Rename ${name}`}
          title={`Rename ${name}`}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-primary"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Rename {noun}</DialogTitle>
            <DialogDescription>Only you see this — it labels the {noun} in this list.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="rename-name">Name</Label>
            <Input
              id="rename-name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={FUNNEL_NAME_MAX_LENGTH}
              autoFocus
            />
            {publicPath ? (
              <p className="text-xs text-muted-foreground">
                The address stays <span className="font-mono">{publicPath}</span> — renaming never moves a
                page anyone has already been sent to.
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
