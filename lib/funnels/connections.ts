// lib/funnels/connections.ts — what leads where, for one funnel.
//
// ---------------------------------------------------------------------------
// THE DEFECT THIS EXISTS FOR
// ---------------------------------------------------------------------------
// Nothing in the product could answer "do my pages join up?", so nothing could
// tell the owner that they did not. A read-only probe of a real funnel found
// six CTAs — three in-page anchors, one program, one booking, one /contact —
// and ZERO links to another page, with its form set to show a message. Every
// page had been built and none of them led anywhere. The builder edited one
// page at a time and knew nothing about its siblings, so there was no layer
// that could even have noticed.
//
// This is that layer, and it is the ONLY one: the step rail, the publish
// review and `autoConnectOps` below all read it, so they cannot disagree about
// whether a page is connected.
//
// ---------------------------------------------------------------------------
// IT IS NOT A GATE, AND THAT DECIDES ITS ERROR BEHAVIOUR
// ---------------------------------------------------------------------------
// `resolveDoc` THROWS on a document it cannot parse, because a clean empty
// result there would wrongly unblock publish. This module does the opposite
// and skips what it cannot read, because it renders the rail for EVERY page of
// the funnel at once: one corrupt draft must cost that page its arrow, not
// take down navigation for the whole funnel. The gate is still `publishGate`,
// which sees one document and refuses it properly.
//
// ---------------------------------------------------------------------------
// TWO PATH FORMATS EXIST AND THIS FILE USES THE OTHER ONE
// ---------------------------------------------------------------------------
// `resolve.ts` reports `plans[0].cta` — brackets — for telling a human where a
// problem is. This module reports `plans.0.cta` — dots — because its paths are
// fed to `patchForPath`, which splits on "." to build the props patch that
// actually writes the fix. Same location, two spellings, two jobs. Anything
// converting between them must do it explicitly.

import { ctaWithLabelSchema, type SectionDoc } from "@/lib/funnels/sections/registry"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One page of the funnel, with whatever document it currently holds. */
export interface StepWithDoc {
  id: string
  name: string
  slug: string
  position: number
  isEntry: boolean
  /** `null` for a page never built, or one whose draft no longer parses. */
  doc: SectionDoc | null
}

/**
 * Where one button or form actually sends someone.
 *
 * `none` is the important member. It covers a form that only shows a message
 * AND a CTA still carrying `blankValueFor`'s `href: "/"` placeholder — both of
 * which mean "nobody has chosen yet", which is exactly what the rail needs to
 * say and what `autoConnectOps` is allowed to fix.
 */
export type Destination =
  | { kind: "step"; slug: string; exists: boolean }
  | { kind: "external"; href: string }
  /** program / session pack / event / booking — real, and outside the funnel. */
  | { kind: "offer"; what: string }
  | { kind: "anchor"; sectionId: string }
  | { kind: "none" }

export interface Connection {
  fromStepId: string
  sectionId: string
  /** Dotted props path within that section — see the format note above. */
  field: string
  /** The button's own text, or "Form submit". What the owner will recognise. */
  label: string
  via: "cta" | "form"
  to: Destination
}

export interface FunnelConnections {
  connections: Connection[]
  /** Points at a page this funnel does not have. Blocks publish. */
  broken: Connection[]
  /**
   * Page ids with no WORKING link to another page, excluding the one with the
   * highest `position` — which is supposed to end. Warns only.
   */
  deadEnds: string[]
}

/** What a form's success destination is called in the rail. */
const FORM_SUBMIT_LABEL = "Form submit"

/**
 * `blankValueFor` in `fields.ts` builds every new button with this exact href
 * and its own comment defines it as a placeholder — "obviously a placeholder
 * rather than a dead link to somewhere real". Honoured here rather than
 * re-decided: if this module reported it as a destination, an unwired button
 * would look wired and `autoConnectOps` would have nothing to key on.
 */
const UNSET_HREF = "/"

// ---------------------------------------------------------------------------
// Reading a destination
// ---------------------------------------------------------------------------

/**
 * `/go/<thisFunnel>` is the entry page; `/go/<thisFunnel>/<slug>` is that page.
 * Anything else — including ANOTHER funnel's page — is not ours.
 *
 * Returns `null` for "not a link into this funnel", which the caller turns into
 * `external`. The separator matters: without it, funnel "camp" would claim
 * "/go/camp-2026/thanks".
 */
function internalPage(
  href: string,
  funnelSlug: string,
  known: Set<string>,
  entrySlug: string,
): Destination | null {
  const base = `/go/${funnelSlug}`
  if (href === base) return { kind: "step", slug: entrySlug, exists: true }
  if (!href.startsWith(`${base}/`)) return null

  const rest = href.slice(base.length + 1).split(/[?#]/)[0]
  if (rest === "" || rest.includes("/")) return null

  let slug = rest
  try {
    slug = decodeURIComponent(rest)
  } catch {
    // A malformed escape is not a page of this funnel; fall through with the
    // raw text so it is reported broken rather than throwing the whole rail.
  }
  return { kind: "step", slug, exists: known.has(slug) }
}

function destinationForTarget(
  target: Record<string, unknown>,
  funnelSlug: string,
  known: Set<string>,
  entrySlug: string,
): Destination {
  const kind = typeof target.kind === "string" ? target.kind : ""

  if (kind === "step") {
    const slug = typeof target.stepSlug === "string" ? target.stepSlug : ""
    return { kind: "step", slug, exists: known.has(slug) }
  }
  if (kind === "anchor") {
    return { kind: "anchor", sectionId: typeof target.sectionId === "string" ? target.sectionId : "" }
  }
  if (kind === "url") {
    const href = typeof target.href === "string" ? target.href : ""
    if (href === UNSET_HREF || href === "") return { kind: "none" }
    return internalPage(href, funnelSlug, known, entrySlug) ?? { kind: "external", href }
  }
  // A booking target is `z.object({ kind: z.literal("booking") })` — it carries
  // no destination, and `renderCtaTarget` hands the island only a label. So it
  // always goes to the enquiry page and there is nothing here to wire.
  if (kind === "booking") return { kind: "offer", what: "the booking enquiry" }
  if (kind === "program" || kind === "session_pack" || kind === "event") {
    return { kind: "offer", what: typeof target.ref === "string" ? target.ref : "" }
  }
  return { kind: "none" }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * Every CTA site in one section's props, as `[dottedPath, cta]`.
 *
 * Recognised with `ctaWithLabelSchema.safeParse` — the SAME mechanism
 * `resolve.ts` uses — rather than a table of known paths, so a section kind
 * that grows a new button is picked up without editing this file.
 */
function ctaSites(value: unknown, path: string, out: Array<[string, { label: string; target: Record<string, unknown> }]>): void {
  if (value === null || typeof value !== "object") return

  const parsed = ctaWithLabelSchema.safeParse(value)
  if (parsed.success) {
    const cta = value as { label?: unknown; target?: unknown }
    if (cta.target !== null && typeof cta.target === "object") {
      out.push([
        path,
        {
          label: typeof cta.label === "string" ? cta.label : "",
          target: cta.target as Record<string, unknown>,
        },
      ])
    }
    // A CTA is a leaf: its `target` is a typed union, never a nested CTA.
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => ctaSites(item, path === "" ? String(index) : `${path}.${index}`, out))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    ctaSites(child, path === "" ? key : `${path}.${key}`, out)
  }
}

/**
 * The connections one page's document declares.
 *
 * Never throws — see the header. A section that is not shaped like a section is
 * skipped, not fatal.
 */
function connectionsForPage(
  step: StepWithDoc,
  funnelSlug: string,
  known: Set<string>,
  entrySlug: string,
): Connection[] {
  const sections = step.doc?.sections
  if (!Array.isArray(sections)) return []

  const found: Connection[] = []
  for (const section of sections) {
    if (section === null || typeof section !== "object") continue
    const sectionId = typeof section.id === "string" ? section.id : ""
    const props = section.props
    if (props === null || typeof props !== "object") continue

    const sites: Array<[string, { label: string; target: Record<string, unknown> }]> = []
    ctaSites(props, "", sites)
    for (const [field, cta] of sites) {
      found.push({
        fromStepId: step.id,
        sectionId,
        field,
        label: cta.label,
        via: "cta",
        to: destinationForTarget(cta.target, funnelSlug, known, entrySlug),
      })
    }

    // The form's success destination. It is not a CTA — it has no `target` —
    // and on a lead-capture funnel it is THE connector: `successMode` defaults
    // to "message", so a form that nobody has configured captures the lead and
    // stops dead in front of a thank-you page that was built and never reached.
    if (section.kind === "form") {
      const record = props as Record<string, unknown>
      const redirectUrl = typeof record.redirectUrl === "string" ? record.redirectUrl : ""
      const redirecting = record.successMode === "redirect" && redirectUrl !== ""
      found.push({
        fromStepId: step.id,
        sectionId,
        // The two fields move together, so the pair is addressed by the one
        // the owner actually chooses. `successMode` alone would be a patch
        // that leaves the URL behind.
        field: "redirectUrl",
        label: FORM_SUBMIT_LABEL,
        via: "form",
        to: redirecting
          ? (internalPage(redirectUrl, funnelSlug, known, entrySlug) ?? {
              kind: "external",
              href: redirectUrl,
            })
          : { kind: "none" },
      })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/**
 * Every connection in one funnel, plus the two things worth acting on.
 *
 * `funnelSlug` is a parameter rather than derived from the steps: it is the
 * only thing that makes a raw `redirectUrl` legible as an internal link, and
 * taking it here keeps this function pure and trivially testable.
 */
export function funnelConnections(funnelSlug: string, steps: StepWithDoc[]): FunnelConnections {
  const known = new Set(steps.map((step) => step.slug))
  const entrySlug = steps.find((step) => step.isEntry)?.slug ?? steps[0]?.slug ?? ""

  const connections: Connection[] = []
  for (const step of steps) {
    connections.push(...connectionsForPage(step, funnelSlug, known, entrySlug))
  }

  const broken = connections.filter((entry) => entry.to.kind === "step" && !entry.to.exists)

  // BY POSITION, not by array order. A caller that hands these over unsorted
  // must not turn the entry page into "the last page" and silence its warning.
  const lastId =
    steps.length === 0
      ? null
      : steps.reduce((furthest, step) => (step.position > furthest.position ? step : furthest)).id

  // A BROKEN link is not an exit. A page whose only way out 404s is worse off
  // than one with no way out, not better — so `exists` is required here.
  const leadsOn = new Set(
    connections
      .filter((entry) => entry.to.kind === "step" && entry.to.exists)
      .map((entry) => entry.fromStepId),
  )
  const deadEnds = steps
    .filter((step) => step.id !== lastId && !leadsOn.has(step.id))
    .map((step) => step.id)

  return { connections, broken, deadEnds }
}

// ---------------------------------------------------------------------------
// autoConnectOps — the repair tool
// ---------------------------------------------------------------------------
//
// FOR FUNNELS THAT ALREADY EXIST. New pages are connected by the model, which
// is told which page comes next; a button added in the inspector is connected
// by the picker. Neither of those helps the funnels already built, whose
// buttons still carry the placeholder and whose forms still show a message.
//
// IT IS ONLY ALLOWED TO TOUCH WHAT NOBODY CHOSE, and there are exactly two
// such things. Everything else on the page is somebody's decision — including
// a URL that looks unhelpful, and including a step link with a typo in it,
// because a typo is still a choice and overwriting it would destroy the only
// evidence of what was meant.
//
// An earlier draft of this design had this function doing all the connecting.
// That was wrong in a way worth recording: it can only recognise the
// INSPECTOR's placeholder, and a freshly drafted page has never been near the
// inspector — the model writes whatever it likes. One mechanism would have
// left new funnels exactly as disconnected as before while appearing to fix
// them.

import { patchForPath } from "@/lib/funnels/sections/patch"
import type { SectionOp } from "@/lib/funnels/sections/apply"

export interface AutoConnectTarget {
  funnelSlug: string
  nextStepSlug: string
}

/** One change, in the words the rail shows the owner before applying it. */
export interface AutoConnectChange {
  sectionId: string
  field: string
  /** The button's text, or "Form submit". */
  label: string
  /** The page slug it will point at. */
  to: string
}

export interface AutoConnectPlan {
  ops: SectionOp[]
  changes: AutoConnectChange[]
}

/** Is this target the placeholder `blankValueFor` writes, and nothing else? */
function isUnsetCta(target: Record<string, unknown>): boolean {
  return target.kind === "url" && target.href === UNSET_HREF
}

/**
 * The ops that would connect ONE page to the next.
 *
 * Returns `{ops: [], changes: []}` when nothing qualifies, so the caller can
 * say "nothing to connect here" rather than pretending it did something.
 *
 * Never throws, for the same reason `funnelConnections` does not: it runs
 * across every page of a funnel at once.
 */
export function autoConnectOps(doc: SectionDoc, target: AutoConnectTarget): AutoConnectPlan {
  const sections = doc?.sections
  if (!Array.isArray(sections)) return { ops: [], changes: [] }

  const redirectUrl = `/go/${target.funnelSlug}/${target.nextStepSlug}`
  const ops: SectionOp[] = []
  const changes: AutoConnectChange[] = []

  for (const section of sections) {
    if (section === null || typeof section !== "object") continue
    const sectionId = typeof section.id === "string" ? section.id : ""
    const props = section.props
    if (props === null || typeof props !== "object") continue

    // ONE PATCH PER SECTION, BUILT AGAINST AN EVOLVING COPY. Two CTAs in the
    // same repeater share a top-level key (`plans`), so patching them
    // independently and merging the results would keep only the last one —
    // and two `update_section` ops for the same id would do the same, since
    // `applyOps` merges props shallow per top-level key.
    const working = structuredClone(props) as Record<string, unknown>
    let patch: Record<string, unknown> = {}
    let touched = false

    const sites: Array<[string, { label: string; target: Record<string, unknown> }]> = []
    ctaSites(props, "", sites)
    for (const [field, cta] of sites) {
      if (!isUnsetCta(cta.target)) continue
      const next = { label: cta.label, target: { kind: "step", stepSlug: target.nextStepSlug } }
      const fragment = patchForPath(working, field, next)
      Object.assign(working, fragment)
      patch = { ...patch, ...fragment }
      touched = true
      changes.push({ sectionId, field, label: cta.label, to: target.nextStepSlug })
    }

    if (section.kind === "form") {
      const record = props as Record<string, unknown>
      const hasUrl = typeof record.redirectUrl === "string" && record.redirectUrl !== ""
      const mode = record.successMode
      // HALF-CONFIGURED IS STILL CONFIGURED. A form carrying a redirect URL is
      // left alone even if `successMode` was never switched over, because that
      // URL is the only evidence of what the owner meant.
      const untouched = !hasUrl && (mode === undefined || mode === "message")
      if (untouched) {
        // BOTH KEYS TOGETHER. `formIslandSchema`'s superRefine rejects
        // `successMode: "redirect"` with no `redirectUrl`, so writing one
        // without the other is an op `applyOps` refuses outright.
        patch = { ...patch, successMode: "redirect", redirectUrl }
        touched = true
        changes.push({
          sectionId,
          field: "redirectUrl",
          label: FORM_SUBMIT_LABEL,
          to: target.nextStepSlug,
        })
      }
    }

    if (touched) ops.push({ op: "update_section", id: sectionId, props: patch })
  }

  return { ops, changes }
}
