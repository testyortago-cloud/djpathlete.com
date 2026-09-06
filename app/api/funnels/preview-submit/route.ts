// A TEST RUN OF A FORM ON AN UNPUBLISHED PAGE.
//
// ---------------------------------------------------------------------------
// WHY THIS ROUTE EXISTS RATHER THAN A FLAG ON THE LIVE ONE
// ---------------------------------------------------------------------------
// `/api/funnels/submit` reads the field list from `getPublishedFormConfig`,
// which returns null until a version row exists (lib/db/funnels.ts:584), so on
// a draft it answers "This form is no longer available." That is not a bug to
// route around: the indirection IS its security model — the browser never gets
// to say what the form contained, so a tampered payload cannot inject columns
// and a form key that was never published cannot submit at all. Teaching it to
// read drafts would weaken the one route that protects real leads.
//
// So this route reads the DRAFT instead, and pays for that twice:
//
//   1. IT IS ADMIN/STAFF GATED and answers 404 to everyone else — the same gate
//      and the same fail-closed shape as the preview page it is submitted from.
//
//   2. IT WRITES NOTHING. No submission row, no lead user, no contact-spine
//      capture, no consent row, no coach email, no Stripe session. An `is_test`
//      column on `funnel_submissions` was considered and rejected: that table
//      has seven read sites plus three lead counts plus the attribution join,
//      and one missed filter puts fake leads in a real export. Writing nothing
//      satisfies "never pollutes the leads list" by construction rather than by
//      a filter somebody has to remember.
//
// THE VALIDATION BELOW IS A MIRROR OF THE LIVE ROUTE'S, NOT A SHARED HELPER.
// Sharing it would mean this route's needs could change rules that guard real
// leads. The duplication is the point; if the two drift, the preview lies about
// what the live form will accept, and THAT is a bug worth a test rather than a
// refactor.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getDraft } from "@/lib/db/funnel-builder"
import { getFunnelById, getFunnelBySlug, getStep, listSteps } from "@/lib/db/funnels"
import { getEventById } from "@/lib/db/events"
import { funnelFormFieldSchema, type FunnelFormField } from "@/lib/funnels/islands"
import { livePathToPreview } from "@/lib/funnels/preview-path"
import type { SectionDoc } from "@/lib/funnels/sections/registry"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

const bodySchema = z.object({
  stepId: z.string().uuid(),
  formKey: z.string().min(1).max(40),
  values: z.record(z.string(), z.string().max(2000)),
})

/**
 * 404 and never 403 — matching the preview page's gate. The route does not
 * confirm that a step id exists to someone who may not look at it.
 */
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

/**
 * What the live page would have done next, said rather than done.
 *
 * Only the internal redirect is ACTED on, and that is the funnel walk. A
 * checkout and an external URL are both places the owner cannot come back from
 * mid-test, so they are reported instead.
 */
type Outcome =
  | { kind: "message" }
  | { kind: "redirect"; href: string }
  | { kind: "external"; href: string }
  | { kind: "checkout"; label: string }
  | { kind: "no-draft"; stepName: string }

export async function POST(request: Request) {
  const session = await auth()
  const role = session?.user?.role
  if (role !== "admin" && role !== "staff") return notFound()

  // 404, NOT 403 — same fail-closed shape as the role check above. A staff
  // session with no accessible business is indistinguishable, from the
  // outside, from one that was never admin/staff at all.
  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return notFound()
    throw err
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid submission." }, { status: 400 })
  const { stepId, formKey, values } = parsed.data

  const step = await getStep(stepId)
  if (!step) return notFound()
  const funnel = await getFunnelById(step.funnel_id)
  if (!funnel) return notFound()

  const draft = await getDraft(stepId)
  // `docInvalid` is NOT the same as "no draft" and must not be collapsed into
  // it: one is a page nobody has written, the other is a legacy blob this
  // builder cannot read, and telling the owner the wrong one sends them to the
  // wrong fix.
  if (draft?.docInvalid) {
    return NextResponse.json({ error: "This page's draft can't be read." }, { status: 409 })
  }
  if (!draft?.doc) return notFound()

  const props = findFormProps(draft.doc, formKey)
  if (!props) return notFound()

  const fieldsResult = z.array(funnelFormFieldSchema).safeParse(props.fields)
  if (!fieldsResult.success) {
    return NextResponse.json({ error: "This form is misconfigured." }, { status: 409 })
  }
  const fields: FunnelFormField[] = fieldsResult.data

  // THE SAME RULES THE LIVE ROUTE APPLIES, IN THE SAME ORDER, so a form that
  // passes here passes there. The draft doc is the authority on which fields
  // exist — anything the browser sent that the form does not declare is
  // discarded rather than echoed back, or the panel would show the owner a
  // field their page does not have.
  //
  // CAPTURED CARRIES THE FIELD'S **LABEL**, NOT ITS NAME. `field.name` is
  // `athlete_name` / `parent_name` — a column name, and the audience for this
  // panel is the coach who runs the camp. Showing them the wire name is the
  // same mistake as showing them a raw timestamp: it reads as something being
  // broken. The label is the word already on screen next to the box they typed
  // in, so it is also the word that lets them check the right field captured
  // the right value.
  //
  // An ARRAY, not an object, so the panel lists fields in the order the form
  // asks for them and two fields sharing a label cannot collide.
  const captured: Array<{ label: string; value: string }> = []
  for (const field of fields) {
    const value = (values[field.name] ?? "").trim()
    if (field.required && value.length === 0) {
      return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 })
    }
    if (field.type === "email" && value.length > 0 && !z.string().email().safeParse(value).success) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }
    if (value.length > 0) captured.push({ label: field.label, value })
  }

  return NextResponse.json({ ok: true, outcome: await outcomeFor(props, businessId), captured })
}

async function outcomeFor(props: Record<string, unknown>, businessId: string): Promise<Outcome> {
  if (props.successMode === "checkout") {
    // A NICETY THAT MAY NOT FAIL THE TEST RUN. Naming the camp is friendlier
    // than "a checkout", but the owner is testing the FORM — a catalogue read
    // that throws must not turn their test into an error.
    const eventId = typeof props.eventId === "string" ? props.eventId : null
    const event = eventId ? await getEventById(businessId, eventId).catch(() => null) : null
    return { kind: "checkout", label: event?.title ?? "this camp" }
  }

  if (props.successMode !== "redirect") return { kind: "message" }

  const redirectUrl = typeof props.redirectUrl === "string" ? props.redirectUrl : ""
  if (!redirectUrl) return { kind: "message" }

  const previewHref = livePathToPreview(redirectUrl)
  if (!previewHref) return { kind: "external", href: redirectUrl }

  // A JOURNEY THAT ENDS ON A BLANK PAGE IS A FINDING, NOT A CRASH. Walking the
  // owner into an empty preview and letting them work out why is the worse
  // answer, so the next step's draft is checked before the redirect is offered.
  //
  // Every read here degrades to "just go there": the redirect is still the
  // right answer, and a catalogue that cannot be read is not a reason to refuse
  // the walk.
  const [, , slug, nextSlug] = previewHref.split("/")
  const target = await getFunnelBySlug(decodeURIComponent(slug ?? "")).catch(() => null)
  if (!target) return { kind: "redirect", href: previewHref }

  const steps = await listSteps(target.id).catch(() => [])
  const next = nextSlug
    ? steps.find((s) => s.slug === decodeURIComponent(nextSlug))
    : steps.find((s) => s.is_entry)
  if (!next) return { kind: "redirect", href: previewHref }

  const nextDraft = await getDraft(next.id).catch(() => null)
  if (!nextDraft?.doc) return { kind: "no-draft", stepName: next.name }

  return { kind: "redirect", href: previewHref }
}

/**
 * The form island's props, found by key in the DRAFT document.
 *
 * A form SECTION's props ARE the island's props — `formSectionPropsSchema` is
 * `{heading, sub, proofPoints}` intersected with `formIslandSchema` — so
 * `formKey` sits at the top level of `section.props` and needs no unwrapping.
 */
function findFormProps(doc: SectionDoc, formKey: string): Record<string, unknown> | null {
  for (const section of doc.sections) {
    const props = section.props as Record<string, unknown> | undefined
    if (props?.formKey === formKey) return props
  }
  return null
}
