"use client"

// components/admin/contacts/ContactTags.tsx — the tag pills on a contact record.
//
// The one part of this screen that WRITES. Everything else on the contact
// record is read-only by design (editing a contact's name, email or phone is
// out of scope for this phase — identity is the spine's job, and hand-editing
// it invites duplicates the merger cannot see).
//
// OPTIMISTIC, AND IT DOES NOT router.refresh() AFTERWARDS. The pill appears the
// moment it is typed; on failure the list is put back the way it was and the
// error is shown, so the operator is never left looking at a tag that is not in
// the database.
//
// The refresh was removed deliberately, and it is not a performance tweak.
// router.refresh() re-executes the contact page's server component, and that
// page records a `contact.viewed` row in the `admin_read_sensitive` audit
// category. Refreshing after every tag write would file a sensitive-READ entry
// for each WRITE — filling the one trail whose purpose is "who opened whose
// record" with entries nobody performed. On success the optimistic list is
// already exactly what the server now holds (the route answers with the stored,
// normalised tag), so there was nothing to reconcile anyway.
//
// Light-only, like the rest of the admin: `.dark` is a class variant these
// components were never built against.

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
// From the PURE module, never from lib/db/contact-tags.ts: this is a client
// component, and the DAL imports the service-role Supabase client.
import { MAX_TAG_LENGTH, normaliseTag } from "@/lib/contacts/tag-format"

export function ContactTags({ contactId, tags }: { contactId: string; tags: string[] }) {
  const [pending, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  // Mirrors the server list so a pill can appear (or vanish) immediately. It is
  // replaced by the server's answer on every refresh.
  const [optimistic, setOptimistic] = useState<string[] | null>(null)

  const shown = optimistic ?? tags

  async function send(method: "POST" | "DELETE", tag: string) {
    const res = await fetch(`/api/admin/contacts/${contactId}/tags`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tag }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? "That did not save. Please try again.")
    }
  }

  function add() {
    // Validated with the SAME function the route and the DAL use, so what is
    // rejected here is exactly what would be rejected there.
    const tag = normaliseTag(draft)
    if (tag === null) {
      toast.error(`A tag must be between 1 and ${MAX_TAG_LENGTH} characters.`)
      return
    }
    if (shown.includes(tag)) {
      toast.info(`This contact already has the tag "${tag}".`)
      setDraft("")
      setAdding(false)
      return
    }

    const before = shown
    setOptimistic([...shown, tag].sort())
    setDraft("")
    setAdding(false)

    startTransition(async () => {
      try {
        await send("POST", tag)
        toast.success(`Tagged "${tag}".`)
      } catch (err) {
        setOptimistic(before)
        toast.error(err instanceof Error ? err.message : "That did not save.")
      }
    })
  }

  function remove(tag: string) {
    const before = shown
    setOptimistic(shown.filter((value) => value !== tag))

    startTransition(async () => {
      try {
        await send("DELETE", tag)
        toast.success(`Removed "${tag}".`)
      } catch (err) {
        setOptimistic(before)
        toast.error(err instanceof Error ? err.message : "That did not save.")
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.length === 0 && !adding ? <span className="text-sm text-muted-foreground">No tags yet.</span> : null}

      {shown.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            disabled={pending}
            aria-label={`Remove the tag ${tag}`}
            className="rounded-full p-0.5 hover:bg-primary/20 disabled:opacity-50"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                add()
              }
              if (event.key === "Escape") {
                setDraft("")
                setAdding(false)
              }
            }}
            maxLength={MAX_TAG_LENGTH}
            placeholder="e.g. camp-2026"
            aria-label="New tag"
            className="h-7 w-40 rounded-md border border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={add} disabled={pending}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setDraft("")
              setAdding(false)
            }}
          >
            Cancel
          </Button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Plus className="size-3" aria-hidden />
          Add a tag
        </button>
      )}
    </div>
  )
}
