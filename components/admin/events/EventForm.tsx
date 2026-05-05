"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarRange,
  DollarSign,
  HeartHandshake,
  Image as ImageIcon,
  Info,
  MapPin,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EventHeroImageUpload } from "@/components/admin/events/EventHeroImageUpload"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { humanizeFieldError, summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"
import type { Event, EventStatus, EventType } from "@/types/database"

interface EventFormProps {
  event?: Event
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

const FIELD_LABELS: Record<string, string> = {
  type: "Event type",
  focus_areas: "Focus areas",
  audience: "Who it's for",
}

const humanizeError = (field: string, raw?: string) => humanizeFieldError(field, raw, FIELD_LABELS)

interface SectionProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  children: React.ReactNode
}

function Section({ icon: Icon, title, description, children }: SectionProps) {
  return (
    <section className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-start gap-2 mb-5">
        <Icon className="size-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold text-primary leading-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function EventForm({ event }: EventFormProps) {
  const router = useRouter()
  const isEdit = !!event

  const [type, setType] = useState<EventType>(event?.type ?? "clinic")
  const [title, setTitle] = useState(event?.title ?? "")
  const [slug, setSlug] = useState(event?.slug ?? "")
  const [slugAutoFilled, setSlugAutoFilled] = useState(!event)
  const [summary, setSummary] = useState(event?.summary ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [focusAreasInput, setFocusAreasInput] = useState("")
  const [focusAreas, setFocusAreas] = useState<string[]>(event?.focus_areas ?? [])
  const [audienceInput, setAudienceInput] = useState("")
  const [audience, setAudience] = useState<string[]>(event?.audience ?? [])
  const [locationName, setLocationName] = useState(event?.location_name ?? "")
  const [locationAddress, setLocationAddress] = useState(event?.location_address ?? "")
  const [locationMapUrl, setLocationMapUrl] = useState(event?.location_map_url ?? "")
  const [capacity, setCapacity] = useState(event?.capacity ?? 10)
  const [ageMin, setAgeMin] = useState<number | "">(event?.age_min ?? "")
  const [ageMax, setAgeMax] = useState<number | "">(event?.age_max ?? "")
  const [startDate, setStartDate] = useState(event?.start_date?.slice(0, 16) ?? "")
  // Clinics edit end as datetime-local (slice 16); camps edit end as date (slice 10).
  const [endDate, setEndDate] = useState(
    event?.end_date
      ? event.type === "clinic"
        ? event.end_date.slice(0, 16)
        : event.end_date.slice(0, 10)
      : "",
  )
  const [sessionSchedule, setSessionSchedule] = useState(event?.session_schedule ?? "")
  const [priceDollars, setPriceDollars] = useState<number | "">(
    event?.price_cents != null ? event.price_cents / 100 : "",
  )
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "draft")
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(event?.hero_image_url ?? null)

  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  async function handleDelete() {
    if (!event) return
    const signups = event.signup_count ?? 0
    const message =
      signups > 0
        ? `This event has ${signups} signup${signups === 1 ? "" : "s"}. Deleting will permanently remove the event AND all ${signups} signup record${signups === 1 ? "" : "s"} (cascades via FK). Continue?`
        : "Delete this event? This cannot be undone."
    if (!confirm(message)) return

    setDeleting(true)
    setFormError(null)
    try {
      const url =
        signups > 0
          ? `/api/admin/events/${event.id}?force=true`
          : `/api/admin/events/${event.id}`
      const res = await fetch(url, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFormError(data.error ?? "Failed to delete event")
        setDeleting(false)
        return
      }
      router.push("/admin/events")
      router.refresh()
    } catch (err) {
      setFormError((err as Error).message)
      setDeleting(false)
    }
  }

  function handleTitleBlur() {
    if (slugAutoFilled || !slug) {
      setSlug(slugify(title))
      setSlugAutoFilled(true)
    }
  }

  function handleSlugChange(v: string) {
    setSlug(v)
    setSlugAutoFilled(false)
  }

  function addFocusArea() {
    const v = focusAreasInput.trim()
    if (v && !focusAreas.includes(v)) setFocusAreas([...focusAreas, v])
    setFocusAreasInput("")
  }

  function removeFocusArea(v: string) {
    setFocusAreas(focusAreas.filter((x) => x !== v))
  }

  function addAudience() {
    const v = audienceInput.trim()
    if (v && !audience.includes(v)) setAudience([...audience, v])
    setAudienceInput("")
  }

  function removeAudience(v: string) {
    setAudience(audience.filter((x) => x !== v))
  }

  async function handleSubmit(submitStatus?: EventStatus) {
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)

    // Treat the admin's wall-clock entry as UTC so the displayed time survives
    // any timezone difference between admin browser, server, and viewers. The
    // public surfaces format with timeZone: "UTC" to match.
    const toIsoWallClockUtc = (s: string): string => {
      if (s.length === 10) return `${s}T00:00:00.000Z` // date-only
      if (s.length === 16) return `${s}:00.000Z` // datetime-local "YYYY-MM-DDTHH:MM"
      return `${s}.000Z`
    }

    const payload: Record<string, unknown> = {
      type,
      title,
      slug,
      summary,
      description,
      focus_areas: focusAreas,
      audience: audience,
      location_name: locationName,
      location_address: locationAddress || null,
      location_map_url: locationMapUrl || null,
      capacity: Number(capacity),
      hero_image_url: heroImageUrl,
      status: submitStatus ?? status,
      age_min: ageMin === "" ? null : Number(ageMin),
      age_max: ageMax === "" ? null : Number(ageMax),
      start_date: startDate ? toIsoWallClockUtc(startDate) : undefined,
    }
    if (type === "camp") {
      payload.end_date = endDate ? toIsoWallClockUtc(endDate) : undefined
      payload.session_schedule = sessionSchedule || null
    } else if (type === "clinic") {
      // null tells the DAL to drop any custom override and re-derive start + 2h.
      payload.end_date = endDate ? toIsoWallClockUtc(endDate) : null
    }
    // Price is optional for both clinics and camps.
    payload.price_dollars = priceDollars === "" ? null : Number(priceDollars)

    try {
      const url = isEdit ? `/api/admin/events/${event!.id}` : "/api/admin/events"
      const method = isEdit ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to save event")
        setFieldErrors(fe)
        setFormError(message)
        setSubmitting(false)
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" })
        }
        return
      }
      router.push("/admin/events")
      router.refresh()
    } catch (err) {
      setFormError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void handleSubmit()
      }}
      className="space-y-6"
    >
      <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={FIELD_LABELS} />

      {/* Actions (sticky top — always in view while scrolling) */}
      <div className="sticky top-0 z-10 -mx-4 sm:mx-0 bg-white/95 backdrop-blur-sm border border-border rounded-xl p-4 flex items-center justify-end gap-3 shadow-sm">
        {isEdit && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleDelete()}
            disabled={submitting || deleting}
            title={
              (event?.signup_count ?? 0) === 0
                ? "Permanently delete this event"
                : `Permanently delete this event AND all ${event?.signup_count ?? 0} attached signups (cascades)`
            }
            className="mr-auto text-destructive hover:text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            <Trash2 className="size-4 mr-1" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/events")} disabled={submitting}>
          Cancel
        </Button>
        {status === "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void handleSubmit("draft")} disabled={submitting}>
              Save as draft
            </Button>
            <Button type="button" onClick={() => void handleSubmit("published")} disabled={submitting}>
              {submitting ? "Saving..." : "Save & publish"}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Saving..." : "Save changes"}
          </Button>
        )}
      </div>

      {/* Basics */}
      <Section icon={Info} title="Basics" description="The headline info shown on the public event page.">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as EventType)} disabled={isEdit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinic">Agility Clinic</SelectItem>
                  <SelectItem value="camp">Performance Camp</SelectItem>
                </SelectContent>
              </Select>
              {isEdit && <p className="text-xs text-muted-foreground">Type is locked after creation.</p>}
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as EventStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleTitleBlur} required />
            {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title[0]}</p>}
          </div>

          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => handleSlugChange(e.target.value.toLowerCase())} required />
            <p className="text-xs text-muted-foreground">URL-safe identifier — auto-filled from title.</p>
            {fieldErrors.slug && <p className="text-xs text-destructive">{fieldErrors.slug[0]}</p>}
          </div>

          <div className="space-y-2">
            <Label>Summary</Label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={300} />
            <p className="text-xs text-muted-foreground">One-line teaser (max 300 characters).</p>
            {fieldErrors.summary && (
              <p className="text-xs text-destructive">{humanizeError("summary", fieldErrors.summary[0])}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} required />
            {fieldErrors.description && (
              <p className="text-xs text-destructive">{humanizeError("description", fieldErrors.description[0])}</p>
            )}
          </div>
        </div>
      </Section>

      {/* Hero image — surfaced early since it's the most visible element on the public page */}
      <Section icon={ImageIcon} title="Hero Image" description="Shown at the top of the public event page and as the cover thumbnail in the admin table.">
        <EventHeroImageUpload value={heroImageUrl} onChange={setHeroImageUrl} eventId={event?.id} />
      </Section>

      {/* Focus areas */}
      <Section icon={Target} title="Focus Areas" description="Skills or themes this event targets.">
        <div className="space-y-3">
          {focusAreas.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {focusAreas.map((fa) => (
                <span
                  key={fa}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                >
                  {fa}
                  <button
                    type="button"
                    onClick={() => removeFocusArea(fa)}
                    className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
                    aria-label={`Remove ${fa}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={focusAreasInput}
              onChange={(e) => setFocusAreasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addFocusArea()
                }
              }}
              placeholder="e.g. Lateral agility — press Enter to add"
            />
            <Button type="button" variant="outline" onClick={addFocusArea}>
              Add
            </Button>
          </div>
        </div>
      </Section>

      {/* Who it's for */}
      <Section
        icon={HeartHandshake}
        title="Who it's for"
        description="Bullet list shown on the public event page. Leave empty to hide the section entirely."
      >
        <div className="space-y-3">
          {audience.length > 0 && (
            <ul className="space-y-2">
              {audience.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 rounded-lg border border-border bg-surface/40 px-3 py-2 text-sm text-foreground"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                  <span className="flex-1">{line}</span>
                  <button
                    type="button"
                    onClick={() => removeAudience(line)}
                    className="rounded-full hover:bg-muted p-0.5 transition-colors text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${line}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={audienceInput}
              onChange={(e) => setAudienceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addAudience()
                }
              }}
              placeholder="e.g. Field and court sport athletes aged 12–18 — press Enter to add"
              maxLength={200}
            />
            <Button type="button" variant="outline" onClick={addAudience}>
              Add
            </Button>
          </div>
          {fieldErrors.audience && (
            <p className="text-xs text-destructive">{humanizeError("audience", fieldErrors.audience[0])}</p>
          )}
        </div>
      </Section>

      {/* Location */}
      <Section icon={MapPin} title="Location" description="Where the event takes place.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Venue Name</Label>
            <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required />
            {fieldErrors.location_name && (
              <p className="text-xs text-destructive">
                {humanizeError("location_name", fieldErrors.location_name[0])}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>
              Address <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} />
            {fieldErrors.location_address && (
              <p className="text-xs text-destructive">
                {humanizeError("location_address", fieldErrors.location_address[0])}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>
              Map URL <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={locationMapUrl}
              onChange={(e) => setLocationMapUrl(e.target.value)}
              placeholder="https://maps.google.com/..."
            />
            {fieldErrors.location_map_url && (
              <p className="text-xs text-destructive">
                {humanizeError("location_map_url", fieldErrors.location_map_url[0])}
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* Capacity & Age */}
      <Section icon={Users} title="Capacity & Eligibility" description="Signup limits and optional age range.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Capacity</Label>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              required
            />
            {fieldErrors.capacity && (
              <p className="text-xs text-destructive">{humanizeError("capacity", fieldErrors.capacity[0])}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>
              Age Min <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              type="number"
              min={0}
              value={ageMin}
              onChange={(e) => setAgeMin(e.target.value === "" ? "" : Number(e.target.value))}
            />
            {fieldErrors.age_min && (
              <p className="text-xs text-destructive">{humanizeError("age_min", fieldErrors.age_min[0])}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>
              Age Max <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              type="number"
              min={0}
              value={ageMax}
              onChange={(e) => setAgeMax(e.target.value === "" ? "" : Number(e.target.value))}
            />
            {fieldErrors.age_max && (
              <p className="text-xs text-destructive">{humanizeError("age_max", fieldErrors.age_max[0])}</p>
            )}
          </div>
        </div>
      </Section>

      {/* Schedule */}
      <Section
        icon={CalendarRange}
        title="Schedule"
        description={
          type === "clinic"
            ? "Set start time. Leave end blank to auto-set to start + 2 hours."
            : "Camps run across a date range with repeating sessions."
        }
      >
        {type === "clinic" ? (
          <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
            <div className="space-y-2">
              <Label>Start (date + time)</Label>
              <Input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
              {fieldErrors.start_date && (
                <p className="text-xs text-destructive">{humanizeError("start_date", fieldErrors.start_date[0])}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>
                End (date + time) <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave blank to auto-set to start + 2 hours.</p>
              {fieldErrors.end_date && (
                <p className="text-xs text-destructive">{humanizeError("end_date", fieldErrors.end_date[0])}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={startDate.slice(0, 10)}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
                {fieldErrors.start_date && (
                  <p className="text-xs text-destructive">
                    {humanizeError("start_date", fieldErrors.start_date[0])}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
                {fieldErrors.end_date && (
                  <p className="text-xs text-destructive">
                    {humanizeError("end_date", fieldErrors.end_date[0])}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Session Schedule</Label>
              <Input
                value={sessionSchedule}
                onChange={(e) => setSessionSchedule(e.target.value)}
                placeholder="M–F, 9–11am"
              />
              <p className="text-xs text-muted-foreground">Free-text description of daily session times.</p>
              {fieldErrors.session_schedule && (
                <p className="text-xs text-destructive">
                  {humanizeError("session_schedule", fieldErrors.session_schedule[0])}
                </p>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* Pricing — optional for clinics, optional for camps */}
      <Section
        icon={DollarSign}
        title="Pricing"
        description="Optional. Leave blank for a free event. Paid events sync to Stripe automatically when you publish."
      >
        <div className="space-y-2 max-w-md">
          <Label>Price (USD)</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="0.00 (free)"
          />
          {fieldErrors.price_dollars && (
            <p className="text-xs text-destructive">
              {humanizeError("price_dollars", fieldErrors.price_dollars[0])}
            </p>
          )}
          {event?.stripe_price_id && (
            <p className="text-xs text-success">Synced with Stripe · {event.stripe_price_id.slice(-8)}</p>
          )}
        </div>
      </Section>

      {/* Actions (bottom copy for discoverability while scrolling) */}
      <div className="-mx-4 sm:mx-0 bg-white/95 border border-border rounded-xl p-4 flex items-center justify-end gap-3 shadow-sm">
        {isEdit && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleDelete()}
            disabled={submitting || deleting}
            title={
              (event?.signup_count ?? 0) === 0
                ? "Permanently delete this event"
                : `Permanently delete this event AND all ${event?.signup_count ?? 0} attached signups (cascades)`
            }
            className="mr-auto text-destructive hover:text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            <Trash2 className="size-4 mr-1" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/events")} disabled={submitting}>
          Cancel
        </Button>
        {status === "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void handleSubmit("draft")} disabled={submitting}>
              Save as draft
            </Button>
            <Button type="button" onClick={() => void handleSubmit("published")} disabled={submitting}>
              {submitting ? "Saving..." : "Save & publish"}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Saving..." : "Save changes"}
          </Button>
        )}
      </div>
    </form>
  )
}
