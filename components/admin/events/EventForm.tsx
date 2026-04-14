"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EventHeroImageUpload } from "@/components/admin/events/EventHeroImageUpload"
import type { Event, EventStatus, EventType } from "@/types/database"

interface EventFormProps {
  event?: Event
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120)
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
  const [locationName, setLocationName] = useState(event?.location_name ?? "")
  const [locationAddress, setLocationAddress] = useState(event?.location_address ?? "")
  const [locationMapUrl, setLocationMapUrl] = useState(event?.location_map_url ?? "")
  const [capacity, setCapacity] = useState(event?.capacity ?? 10)
  const [ageMin, setAgeMin] = useState<number | "">(event?.age_min ?? "")
  const [ageMax, setAgeMax] = useState<number | "">(event?.age_max ?? "")
  const [startDate, setStartDate] = useState(event?.start_date?.slice(0, 16) ?? "")
  const [endDate, setEndDate] = useState(event?.end_date?.slice(0, 10) ?? "")
  const [sessionSchedule, setSessionSchedule] = useState(event?.session_schedule ?? "")
  const [priceDollars, setPriceDollars] = useState<number | "">(
    event?.price_cents != null ? event.price_cents / 100 : "",
  )
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "draft")
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(event?.hero_image_url ?? null)

  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [formError, setFormError] = useState<string | null>(null)

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

  async function handleSubmit(submitStatus?: EventStatus) {
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)

    const payload: Record<string, unknown> = {
      type,
      title,
      slug,
      summary,
      description,
      focus_areas: focusAreas,
      location_name: locationName,
      location_address: locationAddress || null,
      location_map_url: locationMapUrl || null,
      capacity: Number(capacity),
      hero_image_url: heroImageUrl,
      status: submitStatus ?? status,
      age_min: ageMin === "" ? null : Number(ageMin),
      age_max: ageMax === "" ? null : Number(ageMax),
      start_date: startDate ? new Date(startDate).toISOString() : undefined,
    }
    if (type === "camp") {
      payload.end_date = endDate ? new Date(endDate).toISOString() : undefined
      payload.session_schedule = sessionSchedule || null
      payload.price_dollars = priceDollars === "" ? null : Number(priceDollars)
    }

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
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        setFormError(data.error ?? "Failed to save event")
        setSubmitting(false)
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
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }} className="space-y-6">
      {formError && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as EventType)} disabled={isEdit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="clinic">Agility Clinic</SelectItem>
              <SelectItem value="camp">Performance Camp</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as EventStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleTitleBlur} required />
        {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title[0]}</p>}
      </div>

      <div>
        <Label>Slug</Label>
        <Input value={slug} onChange={(e) => handleSlugChange(e.target.value.toLowerCase())} required />
        {fieldErrors.slug && <p className="text-sm text-destructive">{fieldErrors.slug[0]}</p>}
      </div>

      <div>
        <Label>Summary</Label>
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={300} />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} required />
      </div>

      <div>
        <Label>Focus Areas</Label>
        <div className="flex flex-wrap gap-2">
          {focusAreas.map((fa) => (
            <span key={fa} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
              {fa} <button type="button" onClick={() => removeFocusArea(fa)} className="ml-1">×</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={focusAreasInput}
            onChange={(e) => setFocusAreasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFocusArea() } }}
            placeholder="Add a focus area and press Enter"
          />
          <Button type="button" variant="outline" onClick={addFocusArea}>Add</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Location Name</Label>
          <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required />
        </div>
        <div>
          <Label>Address (optional)</Label>
          <Input value={locationAddress} onChange={(e) => setLocationAddress(e.target.value)} />
        </div>
        <div>
          <Label>Map URL (optional)</Label>
          <Input value={locationMapUrl} onChange={(e) => setLocationMapUrl(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>Capacity</Label>
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} required />
        </div>
        <div>
          <Label>Age Min (optional)</Label>
          <Input type="number" min={6} max={21} value={ageMin} onChange={(e) => setAgeMin(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div>
          <Label>Age Max (optional)</Label>
          <Input type="number" min={6} max={21} value={ageMax} onChange={(e) => setAgeMax(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
      </div>

      {type === "clinic" ? (
        <div>
          <Label>Start (date + time)</Label>
          <Input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          <p className="mt-1 text-sm text-muted-foreground">End time will be auto-set to start + 2 hours.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Start date</Label>
              <Input type="date" value={startDate.slice(0, 10)} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div>
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Session schedule (free-text)</Label>
            <Input value={sessionSchedule} onChange={(e) => setSessionSchedule(e.target.value)} placeholder="M–F, 9–11am" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <div>
              <Label>Price (USD)</Label>
              <Input type="number" step="0.01" min={0} value={priceDollars} onChange={(e) => setPriceDollars(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div>
              <Button type="button" disabled title="Available in Phase 3">Sync to Stripe</Button>
            </div>
          </div>
        </>
      )}

      <div>
        <Label>Hero Image</Label>
        <EventHeroImageUpload value={heroImageUrl} onChange={setHeroImageUrl} eventId={event?.id} />
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-6">
        {status === "draft" ? (
          <>
            <Button type="button" variant="outline" onClick={() => void handleSubmit("draft")} disabled={submitting}>
              Save as draft
            </Button>
            <Button type="button" onClick={() => void handleSubmit("published")} disabled={submitting}>
              Save &amp; publish
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={submitting}>Save</Button>
        )}
      </div>
    </form>
  )
}
