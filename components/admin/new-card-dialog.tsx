"use client"

// components/admin/new-card-dialog.tsx — G29 Task 8. A coach putting somebody
// on a pipeline board BY HAND: met at a camp, spoke to on the phone, sent a DM.
//
// IT NEVER STARTS A FOLLOW-UP, and it says so on screen. That invariant is
// enforced one layer down and structurally — `createOpportunityManually`
// (lib/db/pipeline.ts) resolves the contact through `upsertContactIdentity`,
// never `recordContactEvent`, which is the one function that calls
// `enrollIfTriggered`. This dialog does not re-implement it and, more
// importantly, does not route around it: POST /api/admin/pipeline/opportunities
// is the ONLY way a card is created here.
//
// ONE BRANCH PER SUBMISSION, NEVER BOTH. The create route treats `contactId`
// and `person` as an OR and SILENTLY DROPS `person` when both arrive. So the
// two are mutually exclusive in the state as well as in the payload: choosing
// a contact closes the new-person block, and opening the new-person block
// un-chooses the contact. A screen that let both be filled in would discard
// the coach's typing without a word.
//
// THE SERVER'S REFUSAL IS PRINTED WORD FOR WORD. The one a coach will actually
// hit — `Dana Reyes is already on Coaching, in Consulted.` — names the person,
// the board and the stage precisely so it can be acted on. It is also read for
// its `field`, the same way components/admin/pipeline-settings.tsx does, so the
// sentence lands under the box that caused it rather than at the foot of the
// screen. Fix round 1 of Task 7 exists because that was got wrong once already.
//
// THE DIALOG PRIMITIVE CAPS NO HEIGHT. components/ui/dialog.tsx sets no
// max-height, so the result list carries its OWN scroll box — without one a
// full page of matches runs off the bottom of the screen with no way back.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"
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

/** One row of `GET /api/admin/contacts` — `ContactListRow`, minus what a picker never shows. */
export interface ContactMatch {
  id: string
  name: string | null
  email: string | null
  phone_e164: string | null
}

/**
 * One letter matches most of a contact list, so the box waits for two before
 * it asks. Below this the request is not merely wasteful — its answer is
 * noise, and a coach reading it concludes their search does not work.
 */
const MIN_SEARCH_LENGTH = 2

/** Long enough that a fast typist sends one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200

/**
 * How many matches to ask for. The route caps at 20 anyway; asking explicitly
 * is what stops a future change to that default from quietly turning a
 * dropdown into a directory.
 */
const SEARCH_LIMIT = 20

/** The route's own cap (`MAX_NAME_LENGTH`), so a box cannot accept what the server refuses. */
const MAX_NAME_LENGTH = 200

/**
 * THE SAME SENTENCE the create route answers with when a new person has
 * neither an email nor a phone (`PersonSchema`'s refine, in
 * app/api/admin/pipeline/opportunities/route.ts, which in turn mirrors
 * `upsertContactIdentity`'s own requirement). Checked here only so the coach
 * is told without a round trip — the route remains the guard, and a coach who
 * reaches it some other way reads the identical words.
 */
const NEEDS_A_WAY_TO_REACH_THEM = "Add an email or phone number for this person."

const PersonFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Add their name.")
      .max(MAX_NAME_LENGTH, `Name must be ${MAX_NAME_LENGTH} characters or fewer.`),
    // NOT `.email()`. The route does not check the format, and a box that
    // refuses what the server would have accepted is a worse failure than a
    // typo — it has no way out.
    email: z.string().trim(),
    phone: z.string().trim(),
  })
  // Pinned to `email` rather than left pathless: react-hook-form has no
  // dependable slot for a rule that belongs to two fields at once, and the
  // email box is the one directly above the phone box, so the sentence reads
  // in place.
  .refine((data) => data.email.length > 0 || data.phone.length > 0, {
    message: NEEDS_A_WAY_TO_REACH_THEM,
    path: ["email"],
  })

type PersonForm = z.infer<typeof PersonFormSchema>

/**
 * A refusal off a 400, and WHICH BOX it is about.
 *
 * Shaped after components/admin/pipeline-settings.tsx's own `BoardRefusal` —
 * every route in this family answers `{ error, field }`, and throwing `field`
 * away is what once put a create refusal under the card about a different
 * board entirely. `null` means the route attributed it to nothing (a readable
 * DAL refusal, a duplicate card, or no response at all), and those belong at
 * the foot of the dialog.
 */
type Refusal = { message: string; field: string | null }

/**
 * The route's field paths that have a box of their own on this screen.
 * Anything else — `person` (the either/or rule), `pipelineId`, or no field at
 * all — renders at the foot.
 */
const FIELD_SLOTS: Record<string, "name" | "email" | "phone"> = {
  "person.name": "name",
  "person.email": "email",
  "person.phone": "phone",
}

function toRefusal(payload: { error?: unknown; field?: unknown }, fallback: string): Refusal {
  return {
    message: typeof payload.error === "string" && payload.error.length > 0 ? payload.error : fallback,
    field: typeof payload.field === "string" && payload.field.length > 0 ? payload.field : null,
  }
}

/** How a contact reads in one line when their name is missing. */
function contactLabel(contact: ContactMatch): string {
  return contact.name?.trim() || contact.email || contact.phone_e164 || "Unnamed contact"
}

/** The email and phone under a result row, as a person would write them. */
function contactDetail(contact: ContactMatch): string {
  const parts = [contact.email, contact.phone_e164].filter((v): v is string => Boolean(v && v.trim()))
  return parts.length > 0 ? parts.join(" · ") : "No email or phone on file"
}

export function NewCardDialog({
  pipelineId,
  boardName,
  firstStageName,
}: {
  pipelineId: string
  boardName: string
  /**
   * The stage at position 1 — where `createOpportunityManually` files every
   * hand-made card. Named rather than described, because a coach who renamed
   * that stage should read their own word for it. `null` when the board has no
   * stages to name.
   */
  firstStageName?: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0">
          <UserPlus className="size-4" />
          Add someone
        </Button>
      </DialogTrigger>
      {/* Capped and scrollable: the primitive caps nothing, and this dialog can
          hold a result list, a new-person form and a refusal at the same time. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {/* The body is a child so Radix unmounts it on close — every open then
            starts from a clean search box and a clean refusal, the same reason
            GrantProgramDialog resets its choice per card. */}
        <NewCardForm
          pipelineId={pipelineId}
          boardName={boardName}
          firstStageName={firstStageName ?? null}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewCardForm({
  pipelineId,
  boardName,
  firstStageName,
  onDone,
}: {
  pipelineId: string
  boardName: string
  firstStageName: string | null
  onDone: () => void
}) {
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [results, setResults] = useState<ContactMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  /** The term the CURRENT `results` answer. Kept so "nobody matched X" names X and not what is being typed now. */
  const [searchedTerm, setSearchedTerm] = useState("")

  const [selected, setSelected] = useState<ContactMatch | null>(null)
  const [addingNewPerson, setAddingNewPerson] = useState(false)

  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PersonForm>({
    resolver: zodResolver(PersonFormSchema),
    defaultValues: { name: "", email: "", phone: "" },
  })

  // Every keystroke bumps this. A response whose sequence number is no longer
  // the current one is discarded — without it, a slow request for "da" can
  // land after a fast one for "dana" and repopulate the list with the wrong
  // matches.
  const searchSeq = useRef(0)

  useEffect(() => {
    const term = search.trim()
    searchSeq.current += 1
    const seq = searchSeq.current

    if (term.length < MIN_SEARCH_LENGTH) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      setSearchedTerm("")
      return
    }

    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/admin/contacts?search=${encodeURIComponent(term)}&limit=${SEARCH_LIMIT}`)
          const payload = (await res.json().catch(() => ({}))) as { contacts?: unknown; error?: string }
          if (seq !== searchSeq.current) return
          if (!res.ok) {
            // NOT swallowed into an empty list. "Your search failed" and "this
            // person is not in your contacts" are different answers, and only
            // one of them should send a coach off to create a duplicate.
            setResults([])
            setSearchError(payload.error || "Could not search your contacts right now.")
            return
          }
          setResults(Array.isArray(payload.contacts) ? (payload.contacts as ContactMatch[]) : [])
          setSearchError(null)
          setSearchedTerm(term)
        } catch {
          if (seq !== searchSeq.current) return
          setResults([])
          setSearchError("Could not search your contacts. Check your connection and try again.")
        } finally {
          if (seq === searchSeq.current) setSearching(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [search])

  function chooseContact(contact: ContactMatch) {
    setSelected(contact)
    // The other branch closes. `person` alongside `contactId` is dropped by the
    // route without a word, so it must never be possible to fill both in.
    setAddingNewPerson(false)
    setRefusal(null)
  }

  function startNewPerson() {
    setAddingNewPerson(true)
    setSelected(null)
    setRefusal(null)
  }

  async function file(body: Record<string, unknown>, label: string) {
    if (busy) return
    setBusy(true)
    setRefusal(null)
    try {
      const res = await fetch("/api/admin/pipeline/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; field?: string }
      if (!res.ok) {
        // VERBATIM, and attributed. `Dana Reyes is already on Coaching, in
        // Consulted.` is the sentence a coach can act on; a generic toast
        // would throw away the only useful part of it.
        const next = toRefusal(payload, "That card could not be added.")
        setRefusal(next)
        toast.error(next.message)
        return
      }
      toast.success(`${label} is now on ${boardName}.`)
      router.refresh()
      onDone()
    } catch {
      const message = "That card could not be added. Check your connection and try again."
      setRefusal({ message, field: null })
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  function submitNewPerson(data: PersonForm) {
    // Built key by key. `PersonSchema` on the route is `.strict()` with
    // `email: z.string().trim().min(1).optional()`, so an empty string is a
    // 400 — a blank box must be ABSENT from the payload, not present and empty.
    const person: Record<string, string> = { name: data.name.trim() }
    if (data.email.trim()) person.email = data.email.trim()
    if (data.phone.trim()) person.phone = data.phone.trim()
    return file({ pipelineId, person }, person.name)
  }

  function submitExistingContact() {
    if (!selected) return
    return file({ pipelineId, contactId: selected.id }, contactLabel(selected))
  }

  const slot = refusal?.field ? FIELD_SLOTS[refusal.field] : undefined
  /** The refusal the route did not attribute to a box on this screen. */
  const dialogRefusal = refusal && !slot ? refusal : null
  const refusalFor = (field: "name" | "email" | "phone") => (slot === field ? refusal!.message : null)

  const nothingChosen = !addingNewPerson && !selected

  return (
    <form
      onSubmit={(e) => {
        if (addingNewPerson) {
          // handleSubmit preventDefaults for us and only calls through once the
          // resolver is happy.
          void handleSubmit(submitNewPerson)(e)
          return
        }
        e.preventDefault()
        void submitExistingContact()
      }}
    >
      <DialogHeader>
        <DialogTitle>Add someone to {boardName}</DialogTitle>
        <DialogDescription>
          Search the people you already have, or add somebody new.{" "}
          {firstStageName
            ? `Their card starts in "${firstStageName}".`
            : "Their card starts in the first step on this board."}{" "}
          No email is sent and no follow-up is started — this only puts a card on the board.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="new-card-search">Search your contacts</Label>
          <Input
            id="new-card-search"
            value={search}
            placeholder="Name, email or phone number"
            autoComplete="off"
            onChange={(e) => {
              setSearch(e.target.value)
              setRefusal(null)
            }}
            className="mt-1"
          />
        </div>

        {selected ? (
          <div
            data-testid="chosen-contact"
            className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/[0.04] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-primary">{contactLabel(selected)}</p>
              <p className="truncate text-xs text-muted-foreground">{contactDetail(selected)}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Choose someone else
            </Button>
          </div>
        ) : (
          <SearchResults
            results={results}
            searching={searching}
            error={searchError}
            term={searchedTerm}
            typed={search}
            onChoose={chooseContact}
          />
        )}

        {addingNewPerson ? (
          <div data-testid="new-person-fields" className="space-y-3 rounded-lg border border-border bg-surface/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Somebody new</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingNewPerson(false)}>
                Never mind
              </Button>
            </div>
            <PersonField
              id="new-card-name"
              testId="field-name"
              label="Their name"
              error={errors.name?.message ?? refusalFor("name")}
              inputProps={{ maxLength: MAX_NAME_LENGTH, autoComplete: "off", ...register("name") }}
            />
            <PersonField
              id="new-card-email"
              testId="field-email"
              label="Email address"
              error={errors.email?.message ?? refusalFor("email")}
              inputProps={{ type: "email", autoComplete: "off", ...register("email") }}
            />
            <PersonField
              id="new-card-phone"
              testId="field-phone"
              label="Phone number"
              error={errors.phone?.message ?? refusalFor("phone")}
              inputProps={{ type: "tel", autoComplete: "off", ...register("phone") }}
            />
            <p className="text-xs text-muted-foreground">
              One of the two is enough. If this person is already in your contacts, they are matched to the record you
              already have rather than added twice.
            </p>
          </div>
        ) : (
          // `link`, not `ghost`: a ghost button with no padding renders as plain
          // black text in the middle of a form and does not read as something
          // you can press — and this is the only way to the other branch.
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={startNewPerson}>
            Add someone new
          </Button>
        )}
      </div>

      {dialogRefusal ? (
        <p data-testid="new-card-refusal" role="alert" className="mt-4 text-sm text-destructive">
          {dialogRefusal.message}
        </p>
      ) : null}

      <DialogFooter className="mt-5">
        <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        {/* Enabled the moment a branch is chosen. The refusals are the guard;
            a disabled button only hides which sentence would have explained it. */}
        <Button type="submit" disabled={busy || nothingChosen}>
          {busy ? "Adding…" : `Add to ${boardName}`}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SearchResults({
  results,
  searching,
  error,
  term,
  typed,
  onChoose,
}: {
  results: ContactMatch[]
  searching: boolean
  error: string | null
  term: string
  typed: string
  onChoose: (contact: ContactMatch) => void
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (typed.trim().length < MIN_SEARCH_LENGTH) {
    return <p className="text-xs text-muted-foreground">Type at least two letters to look someone up.</p>
  }
  if (searching) {
    return <p className="text-xs text-muted-foreground">Searching…</p>
  }
  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nobody matched &quot;{term}&quot;. Add them as someone new below.</p>
    )
  }

  return (
    // ITS OWN SCROLL BOX. components/ui/dialog.tsx caps no height, so twenty
    // matches would otherwise run off the bottom of the screen.
    <div
      data-testid="contact-results"
      className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1"
    >
      {results.map((contact) => (
        <button
          key={contact.id}
          type="button"
          data-testid={`contact-result-${contact.id}`}
          onClick={() => onChoose(contact)}
          className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface/60"
        >
          <span className="block truncate text-sm font-medium text-foreground">{contactLabel(contact)}</span>
          <span className="block truncate text-xs text-muted-foreground">{contactDetail(contact)}</span>
        </button>
      ))}
    </div>
  )
}

/** One labelled box with its own refusal slot underneath it. */
function PersonField({
  id,
  testId,
  label,
  error,
  inputProps,
}: {
  id: string
  testId: string
  label: string
  error: string | null | undefined
  inputProps: React.ComponentProps<typeof Input>
}) {
  return (
    <div data-testid={testId}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={Boolean(error)} className="mt-1" {...inputProps} />
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
