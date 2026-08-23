import { notFound } from "next/navigation"
import { Button } from "@/components/ui/button"
import { readSmsConsentState } from "@/lib/lead-engine/sms-consent"
import { confirmSmsConsentAction } from "./actions"

// Never statically cached: what this page shows depends on rows that change
// (a consent row, a suppression row) and on a per-contact token.
export const dynamic = "force-dynamic"

/**
 * The page a contact lands on from the "can we text you?" email.
 *
 * THIS PAGE DOES NOT WRITE. It reads the token's state and renders one of five
 * things. The consent row is written only by the server action behind the
 * "I agree" button (./actions.ts) — because mail scanners GET every link in an
 * inbound message, and a page that recorded consent on render would let a
 * robot fabricate somebody's agreement to be texted. The full reasoning lives
 * in lib/lead-engine/sms-consent.ts's header; `readSmsConsentState` is a read
 * on every branch and must stay one.
 *
 * Sits in `(marketing)` so it inherits the site header and footer — the same
 * placement as app/(marketing)/unsubscribe/[token]/page.tsx. Someone who has
 * just been asked to trust this business with their phone number should not
 * land on a page that looks like it belongs to somebody else.
 */
export default async function SmsConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const query = searchParams ? await searchParams : {}
  const justConfirmed = query.done === "1"

  const resolved = await readSmsConsentState(token)

  // 404, never a redirect: middleware.ts covers only /admin and /client, so
  // this route gates itself, and a bad token should look exactly like a page
  // that does not exist.
  if (resolved.state === "invalid_token" || resolved.state === "contact_not_found") notFound()

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {resolved.state === "ask" && <Ask token={token} wording={resolved.wording} />}
        {resolved.state === "already_consented" && <Confirmed justConfirmed={justConfirmed} />}
        {resolved.state === "phone_suppressed" && <Stopped />}
        {resolved.state === "wording_unavailable" && <Unavailable />}
      </div>
    </div>
  )
}

/**
 * The ask. `wording` is the exact sentence `confirmSmsConsent` files as
 * `contact_consents.wording_shown`, handed over by the same
 * `readSmsConsentState` call the write re-runs — never a second copy of the
 * sentence written out here, which could drift from the one on the row.
 */
function Ask({ token, wording }: { token: string; wording: string }) {
  return (
    <div className="text-center">
      <h1 className="font-heading mb-4 text-2xl font-semibold text-primary">Can we text you?</h1>
      <p className="text-muted-foreground mb-6">
        You asked us to set this up, or we asked you. Either way, here is exactly what you would be agreeing to.
      </p>

      <p className="border-border bg-surface/50 mb-6 rounded-xl border p-4 text-left text-sm text-foreground">
        {wording}
      </p>

      <form action={confirmSmsConsentAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">
          I agree
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-sm">
        Do not want texts? Close this page. We will not text you, and you will keep getting our emails as before.
      </p>
    </div>
  )
}

/**
 * Both the "you just agreed" and the "you agreed a while ago" cases. Both are
 * reached only when a real consent row exists — `justConfirmed` comes off the
 * URL and can therefore only pick the heading, never assert the fact.
 */
function Confirmed({ justConfirmed }: { justConfirmed: boolean }) {
  return (
    <div className="text-center">
      <h1 className="font-heading mb-4 text-2xl font-semibold text-primary">
        {justConfirmed ? "You are all set" : "You have already said yes"}
      </h1>
      <p className="text-muted-foreground mb-3">
        {justConfirmed
          ? "Thanks. We can now send you text messages."
          : "We already have your OK to text you. There is nothing more to do here."}
      </p>
      <p className="text-muted-foreground text-sm">
        You can stop the texts at any time. Reply STOP to any text we send, and they will end.
      </p>
    </div>
  )
}

/**
 * The honest answer to somebody whose number is suppressed.
 *
 * They texted STOP at some point, and that reached us from the handset itself
 * (app/api/webhooks/twilio/inbound/route.ts, signature-checked). A link tapped
 * in an email does not overrule a message sent from the phone, and no consent
 * row is written on this branch — so this page must not say "you're all set"
 * to somebody who would stay blocked. It says what actually works instead.
 */
function Stopped() {
  return (
    <div className="text-center">
      <h1 className="font-heading mb-4 text-2xl font-semibold text-primary">We cannot turn texts back on here</h1>
      <p className="text-muted-foreground mb-3">
        Our records show you texted us STOP at some point. We have kept that, so this page has not changed anything.
      </p>
      <p className="text-muted-foreground mb-3">
        To start texts again, send the word START in a text to the number our texts came from. It has to be done by
        text, from your phone, so that we know the request is really from you.
      </p>
      <p className="text-muted-foreground text-sm">Our emails are not affected. Those carry on as before.</p>
    </div>
  )
}

/**
 * `business_settings.display_name` is blank, so there is no sentence that
 * names who would be texting. `hasSmsConsentDisplayName` is the same gate the
 * funnel form checks before it will show its opt-in box. No button here for
 * the same reason: a consent sentence that cannot say who is texting is not
 * consent to anything, and the person is better served by the reply path the
 * email already offers.
 */
function Unavailable() {
  return (
    <div className="text-center">
      <h1 className="font-heading mb-4 text-2xl font-semibold text-primary">This page is not ready yet</h1>
      <p className="text-muted-foreground mb-3">
        Sorry — we cannot take your answer here right now. Nothing has been changed and nothing has been recorded.
      </p>
      <p className="text-muted-foreground text-sm">
        Please reply to the email you got instead, and a person will take care of it.
      </p>
    </div>
  )
}
