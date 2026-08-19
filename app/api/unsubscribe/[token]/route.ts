// app/api/unsubscribe/[token]/route.ts — the RFC 8058 one-click endpoint.
//
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click` obliges the URI in
// `List-Unsubscribe` to accept an HTTPS POST. Gmail's unsubscribe button
// POSTs; the previous target was `app/(marketing)/unsubscribe/[token]/page.tsx`,
// a page, so that POST got a 405 and the reader's unsubscribe silently did
// nothing.
//
// WHY THIS LIVES UNDER /api AND NOT NEXT TO THE PAGE: Next.js App Router
// cannot serve a `route.ts` and a `page.tsx` from the same route segment —
// `normalizeAppPath` maps `/(marketing)/unsubscribe/[token]/page` and
// `/(marketing)/unsubscribe/[token]/route` to the identical pathname
// `/unsubscribe/[token]`, so one entry would shadow the other. The human link
// keeps the rendered page; this is the machine endpoint. Both carry the same
// signed token and both call the same `processUnsubscribe`, so they cannot
// drift.
//
// Public by design: no auth, no session. The signed token IS the
// authorisation — an unsubscribe link has to work from a mail client that has
// never seen this site. `proxy.ts` matches neither `/api/*` in general nor
// this path.

import { NextResponse } from "next/server"
import { processUnsubscribe } from "@/lib/lead-engine/unsubscribe"

export const runtime = "nodejs"
// This handler writes on every call, so it must never be statically cached.
export const dynamic = "force-dynamic"

export async function POST(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const outcome = await processUnsubscribe(token)

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: 404 })
  }

  // RFC 8058 §3.2: the receiving system only needs a success status. Repeat
  // POSTs are expected (a reader may press the button twice, a client may
  // retry) and `processUnsubscribe` is idempotent, so they answer 200 too.
  return NextResponse.json({ ok: true }, { status: 200 })
}

/**
 * Mail clients that do not implement one-click sometimes just show the
 * `List-Unsubscribe` URI to the reader, who opens it in a browser. Answering
 * 405 to that human is worse than sending them to the page the body link
 * already points at, so GET redirects rather than acting.
 *
 * Deliberately a redirect and NOT a copy of the flow: this handler performs no
 * write on GET. The page it redirects to does, which is pre-existing
 * behaviour for the body link — see the alert-path fix in
 * `lib/automation/sequence-tick-runner.ts` for why no internal ops mail is
 * allowed to carry one of these URLs at all.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), 303)
}
