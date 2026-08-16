// POST /api/admin/funnels/ai/plan — step 2 of Ask AI.
//
// Brief + answers in, a plan the create dialog can accept out.
//
// THE CATALOGUE READ LIVES HERE, NOT IN THE SANITISER. `sanitiseFunnelPlan` is
// pure so its rules can be tested without a database; the one rule that needs
// live data — is this a product that actually exists? — is satisfied by reading
// the catalogue here and passing the allowed names in.
//
// That rule is the reason this route exists rather than the client calling the
// model directly. `offer.ref` is just a string: an invented product name passes
// every schema in the stack and lands as a ref `resolve.ts` cannot resolve,
// which renders as a disabled placeholder on a page the owner thinks is done.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { draftFunnelPlan, BRIEF_MAX_LENGTH, MAX_QUESTIONS } from "@/lib/ai/funnel-interview"
import { sanitiseFunnelPlan } from "@/lib/funnels/ai-plan"
import { getTemplate } from "@/lib/funnels/templates"
import { loadCatalogues } from "@/lib/funnels/sections/resolve"

export const runtime = "nodejs"
export const maxDuration = 120

interface AnswerInput {
  question?: unknown
  answer?: unknown
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as
    | { brief?: unknown; answers?: unknown }
    | null
  const brief = typeof body?.brief === "string" ? body.brief.trim() : ""
  if (brief.length < 3) {
    return NextResponse.json({ error: "Tell me what you want to build first." }, { status: 400 })
  }

  const answers = (Array.isArray(body?.answers) ? body.answers : [])
    .slice(0, MAX_QUESTIONS)
    .map((entry: AnswerInput) => ({
      question: typeof entry?.question === "string" ? entry.question : "",
      answer: typeof entry?.answer === "string" ? entry.answer.trim() : "",
    }))
    // An unanswered question is worse than an absent one: it tells the model
    // the coach had nothing to say, when they simply skipped it.
    .filter((entry) => entry.question !== "" && entry.answer !== "")

  let raw
  try {
    raw = await draftFunnelPlan(brief.slice(0, BRIEF_MAX_LENGTH), answers)
  } catch (error) {
    console.error("[funnels/ai/plan] draft failed", error)
    return NextResponse.json({ error: "Could not draft a plan just now." }, { status: 502 })
  }

  // The offer names this account can actually resolve. `loadCatalogues` THROWS
  // on a truncated read and its own comment requires every caller to wrap it —
  // and here a throw must cost the OFFER, not the plan. Degrading to an empty
  // list means the sanitiser drops the offer and the owner links it by hand,
  // which is strictly better than losing the interview they just sat through.
  let allowedOfferNames: string[] = []
  const offerKind = getTemplate(typeof raw?.template === "string" ? raw.template : null)?.offerKind
  if (offerKind) {
    try {
      const catalogues = await loadCatalogues()
      allowedOfferNames = catalogues.offer[offerKind].map((entry) => entry.name)
    } catch (error) {
      console.error("[funnels/ai/plan] catalogue unreadable — plan will carry no offer", error)
    }
  }

  const plan = sanitiseFunnelPlan(raw, { allowedOfferNames })
  if (!plan) {
    // Only reachable when the model named a template that does not exist, which
    // its own schema should already have refused.
    return NextResponse.json({ error: "Could not draft a plan just now." }, { status: 502 })
  }

  return NextResponse.json({ plan })
}
