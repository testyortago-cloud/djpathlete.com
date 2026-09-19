"use client"

// components/admin/funnels/builder/SeoPanel.tsx — the four SEO columns,
// reachable by hand for the first time.
//
// ---------------------------------------------------------------------------
// WHY THIS IS THE WHOLE POINT OF THE TASK
// ---------------------------------------------------------------------------
// `seo_title`, `seo_description`, `og_image_url` and `noindex` have existed on
// `funnel_steps` since migration 00202. `updateStepSchema` accepts all four and
// `updateStep` writes all four, and the public route has read all four since it
// was written. Every one of them is NULL on every row in production, because
// nothing in the product ever rendered an input for them. The reader and the
// write path were both built; the door was not.
//
// ---------------------------------------------------------------------------
// IT LIVES IN THE INSPECTOR RAIL, NOT ON THE SETTINGS SCREEN
// ---------------------------------------------------------------------------
// The funnel settings screen is the obvious home and it is the wrong one:
// `app/(admin)/admin/pages/[id]/page.tsx` redirects a `kind='page'` row
// straight back to `/admin/pages`, so `FunnelDetailScreen` NEVER RENDERS for a
// landing page. A panel there would be invisible to every landing page in the
// product — and landing pages are the rows that most need a share card.
//
// These are per-STEP columns, and the one surface that is per-step and serves
// both kinds identically is this rail, reached the same way from
// `/admin/funnels/<id>/edit/<stepId>` and `/admin/pages/<id>/edit/<stepId>`.
//
// ---------------------------------------------------------------------------
// THIS PANEL DOES NOT TOUCH THE DOCUMENT
// ---------------------------------------------------------------------------
// Same split `ThemePanel` documents. A theme change is a `set_theme` op and
// belongs in the turn log and the undo history. These four are columns on the
// step ROW — there is no document to patch, they survive a revert, and they
// are not part of what gets compiled and frozen into a version. So this emits
// `onSave`, which the caller wires to `PATCH /api/admin/funnels/steps/:id`,
// never to `onOps`. Putting them through the document would make an SEO edit
// undoable by an undo the owner meant for a headline.
//
// Because they are NOT in the compiled document, an SEO edit reaches the live
// page WITHOUT a re-publish — `generateMetadata` reads the step row per
// request. That is the opposite of everything else in this builder and the
// panel says so on screen, because the owner has been trained by the rest of
// this UI to expect the reverse.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { FUNNEL_SEO_LIMITS, resolveFunnelStepSeo } from "@/lib/funnels/seo"
import { SITE_URL } from "@/lib/constants"

/** The four columns, exactly as `updateStepSchema` accepts them. */
export interface SeoPanelValue {
  seo_title: string | null
  seo_description: string | null
  og_image_url: string | null
  noindex: boolean
}

export interface SeoPanelProps {
  funnelName: string
  funnelSlug: string
  stepName: string
  stepSlug: string
  isEntry: boolean
  /** Whether the funnel itself is published — decides "live now" vs "when you publish". */
  funnelIsPublished: boolean
  value: SeoPanelValue
  /** Persists the four columns. The caller owns the request. */
  onSave: (next: SeoPanelValue) => Promise<void>
  busy: boolean
}

/** Trim, then treat whitespace-only as absent — mirrors `clean()` in lib/funnels/seo.ts. */
function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * `og_image_url` is `z.string().url()` on the API, so a relative path is a 400
 * — and the route answers a bare "Invalid request" with no field named. Left
 * unchecked here, the owner types `/images/hero.jpg` (the obvious thing, and
 * what every other image field in this app takes) and gets an unexplained
 * failure. So the check happens where it can say why.
 */
function ogImageError(raw: string): string | null {
  const value = raw.trim()
  if (value === "") return null
  if (value.startsWith("/")) {
    return "Needs the full web address, starting with https:// — not a path beginning with “/”."
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "Needs to start with https://"
    }
  } catch {
    return "That is not a complete web address. It should look like https://…/picture.jpg"
  }
  return null
}

/**
 * The counter under a field.
 *
 * `target` is the CONVENTION's budget, not the API's cap, and the two are
 * deliberately different numbers — see `FUNNEL_SEO_LIMITS`. Going over the
 * target is allowed and turns the count amber; the input itself stops at the
 * API's cap so a save can never come back as a 400.
 */
function Counter({
  count,
  target,
  hardMax,
  idealMin,
  note,
}: {
  count: number
  target: number
  hardMax: number
  idealMin?: number
  note?: string
}) {
  const over = count > target
  const short = idealMin !== undefined && count > 0 && count < idealMin
  const tone = over ? "text-[var(--warning)]" : short ? "text-muted-foreground" : "text-muted-foreground"
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{note}</span>
      <span className={`shrink-0 text-[11px] tabular-nums ${tone}`}>
        {count}/{target}
        {count >= hardMax ? " · limit" : over ? " · long" : short ? " · short" : ""}
      </span>
    </div>
  )
}

export function SeoPanel(props: SeoPanelProps) {
  const [title, setTitle] = useState(props.value.seo_title ?? "")
  const [description, setDescription] = useState(props.value.seo_description ?? "")
  const [ogImage, setOgImage] = useState(props.value.og_image_url ?? "")
  const [noindex, setNoindex] = useState(props.value.noindex)
  const [saving, setSaving] = useState(false)

  // Re-seed when the owner navigates to another step in the rail. The panel is
  // MOUNTED ACROSS that navigation (it lives beside the canvas, which is what
  // swaps), so without this the previous step's copy would be sitting in the
  // boxes, one Save away from being written onto the wrong row.
  useEffect(() => {
    setTitle(props.value.seo_title ?? "")
    setDescription(props.value.seo_description ?? "")
    setOgImage(props.value.og_image_url ?? "")
    setNoindex(props.value.noindex)
  }, [props.value])

  const imageError = ogImageError(ogImage)

  // WHAT A SEARCHER ACTUALLY GETS, not what is in the boxes.
  //
  // Run through the same resolver the public route uses, so the preview shows
  // the FALLBACK when a field is empty rather than showing nothing. The empty
  // rows are the only ones where the two differ, and they are the rows this
  // whole panel exists for.
  const resolved = useMemo(
    () =>
      resolveFunnelStepSeo(
        { name: props.funnelName, slug: props.funnelSlug },
        {
          name: props.stepName,
          slug: props.stepSlug,
          is_entry: props.isEntry,
          seo_title: orNull(title),
          seo_description: orNull(description),
          og_image_url: orNull(ogImage),
          noindex,
        },
      ),
    [
      props.funnelName,
      props.funnelSlug,
      props.stepName,
      props.stepSlug,
      props.isEntry,
      title,
      description,
      ogImage,
      noindex,
    ],
  )

  const dirty =
    orNull(title) !== props.value.seo_title ||
    orNull(description) !== props.value.seo_description ||
    orNull(ogImage) !== props.value.og_image_url ||
    noindex !== props.value.noindex

  const disabled = props.busy || saving
  const canSave = dirty && !disabled && imageError === null

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      await props.onSave({
        seo_title: orNull(title),
        seo_description: orNull(description),
        og_image_url: orNull(ogImage),
        noindex,
      })
    } finally {
      setSaving(false)
    }
  }

  // The rendered <title>, brand suffix included. The convention's 60-character
  // budget is for THIS string, not for the box above it, and showing only the
  // box's own count is how someone writes a 55-character title and ships a
  // 69-character one.
  const renderedTitleLength = resolved.socialTitle.length

  return (
    <div className="space-y-5 p-3">
      <div>
        <h2 className="text-sm font-medium text-primary">Search &amp; sharing</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          What people see in Google, and on the card that appears when this link is posted to Facebook, WhatsApp or a
          group chat.
        </p>
      </div>

      {/* The preview comes FIRST. It is the only part of this panel that
          answers the question the owner actually has, and putting it under
          three form fields means it is below the fold in a 320px rail. */}
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">How it will look</Label>
        <div className="rounded-md border border-border bg-surface/40 p-3">
          <p className="truncate text-[11px] text-muted-foreground">
            {SITE_URL.replace(/^https:\/\//, "")}
            {resolved.canonicalPath}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium text-[#1a0dab]">{resolved.socialTitle}</p>
          {resolved.description ? (
            <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{resolved.description}</p>
          ) : (
            // NOT an error, and worded so it does not read as one. No
            // description is a deliberate choice (see lib/funnels/seo.ts) —
            // Google writes its own from the page. It is still worth filling
            // in, because the one you write is the one you control.
            <p className="mt-0.5 text-xs italic text-muted-foreground">
              No description set — Google will pick a sentence from the page itself.
            </p>
          )}
          {noindex ? (
            <p className="mt-1.5 text-[11px] text-[var(--warning)]">
              Hidden from Google. This page will not appear in search results at all.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="seo-title" className="text-xs uppercase tracking-wide text-muted-foreground">
          Page title
        </Label>
        <Input
          id="seo-title"
          value={title}
          maxLength={FUNNEL_SEO_LIMITS.titleHardMax}
          disabled={disabled}
          placeholder={resolved.titleIsFallback ? props.funnelName : ""}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Counter
          count={title.length}
          target={FUNNEL_SEO_LIMITS.titleTarget}
          hardMax={FUNNEL_SEO_LIMITS.titleHardMax}
          note={`Shows as ${renderedTitleLength} characters`}
        />
        {resolved.titleIsFallback ? (
          <p className="text-[11px] text-muted-foreground">
            Empty, so we are using the {props.isEntry ? "funnel" : "page"} name. Writing your own is what gets the
            click.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="seo-description" className="text-xs uppercase tracking-wide text-muted-foreground">
          Description
        </Label>
        <Textarea
          id="seo-description"
          value={description}
          rows={4}
          maxLength={FUNNEL_SEO_LIMITS.descriptionHardMax}
          disabled={disabled}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Counter
          count={description.length}
          target={FUNNEL_SEO_LIMITS.descriptionTarget}
          idealMin={FUNNEL_SEO_LIMITS.descriptionIdealMin}
          hardMax={FUNNEL_SEO_LIMITS.descriptionHardMax}
          note="Aim for 150–160"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="seo-og-image" className="text-xs uppercase tracking-wide text-muted-foreground">
          Sharing picture
        </Label>
        <Input
          id="seo-og-image"
          value={ogImage}
          disabled={disabled}
          placeholder="https://…/picture.jpg"
          onChange={(event) => setOgImage(event.target.value)}
        />
        {imageError ? (
          <p className="text-[11px] text-[var(--error)]">{imageError}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Leave this empty and we make a card for you, with the page title on it. Add a web address here only if you
            want your own photo instead. Best at 1200×630.
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
        <div className="min-w-0">
          <Label htmlFor="seo-noindex" className="text-sm font-normal text-primary">
            Hide from Google
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Keeps the page working for anyone you send the link to, but keeps it out of search results. Use it for
            thank-you pages.
          </p>
        </div>
        <Switch id="seo-noindex" checked={noindex} disabled={disabled} onCheckedChange={setNoindex} />
      </div>

      <div className="space-y-2">
        <Button className="w-full" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {/* THE SENTENCE THAT STOPS A SUPPORT QUESTION. Everything else in this
            builder needs a publish to reach the public, so an owner who saves
            this and sees no change on the live page will conclude it did not
            work. These four are read per request, outside the frozen version. */}
        <p className="text-[11px] text-muted-foreground">
          {props.funnelIsPublished
            ? "Saving updates the live page straight away — no need to publish again."
            : "Saved with the page. It goes public when you publish."}
        </p>
      </div>
    </div>
  )
}
