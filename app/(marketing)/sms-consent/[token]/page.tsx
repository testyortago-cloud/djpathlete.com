import { notFound } from "next/navigation"
import { readSmsConsentState } from "@/lib/lead-engine/sms-consent"
import { confirmSmsConsentAction } from "./actions"
import { AgreeButton } from "./agree-button"

// Never statically cached: what this page shows depends on rows that change
// (a consent row, a suppression row) and on a per-contact token.
export const dynamic = "force-dynamic"

/**
 * The page a contact lands on from the "can we text you?" email.
 *
 * THIS PAGE DOES NOT WRITE. It reads the token's state and renders one of six
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
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const query = await searchParams
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
        {resolved.state === "email_suppressed" && <Unsubscribed />}
        {resolved.state === "wording_unavailable" && <Unavailable />}
      </div>
    </div>
  )
}

/**
 * The ask. `wording` is not written out here as a second copy of the sentence
 * — it comes from `renderSmsConsentWording`, the one function of the one
 * column that also produces what gets filed.
 *
 * WHAT THE PAGE DOES NOT HAND OVER, AND WHY. `confirmSmsConsent` re-runs
 * `readSmsConsentState` and files the sentence THAT call produces. It does not
 * accept the sentence from this form, and must not: `wording_shown` is a claim
 * about what a person saw, and a claim a client can supply is a claim the
 * client can author. That would leave the compliance record saying whatever a
 * crafted POST said it should.
 *
 * The price is a real, narrow drift window. If `business_settings.display_name`
 * is edited between this render and the press, the row names the business as it
 * is at POST time rather than as it appeared on screen. That is a settings edit
 * landing inside one person's page visit — rare, self-correcting, and it still
 * files a truthful sentence about a real business. A hidden field would close
 * it by reopening the much larger hole above, so it stays open on purpose.
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

      {/*
        The token is the ONLY field. Nothing the reader's browser sends decides
        what gets recorded — see this component's doc comment. The button is a
        client component purely so it can disable itself while the press is in
        flight; a double tap on a slow connection would otherwise file the same
        agreement twice.
      */}
      <form action={confirmSmsConsentAction}>
        <input type="hidden" name="token" value={token} />
        <AgreeButton />
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
 *
 * The last line used to read "Our emails are not affected. Those carry on as
 * before." That was false, and this is where it was found out: a suppression
 * on EITHER identifier sets `isSuppressed` in `loadRunContext`
 * (lib/db/sequences.ts), and `decideStep` exits the run on that flag before it
 * looks at the step kind at all. A texted STOP therefore stops this engine's
 * automatic emails too. Saying otherwise put a promise on the page that the
 * send path had no intention of keeping.
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
      <p className="text-muted-foreground text-sm">
        That STOP also stops the automatic emails we send you, not only the texts. If you would like those back, reply
        to any email you already have from us and a person will sort it out.
      </p>
    </div>
  )
}

/**
 * The honest answer to somebody whose EMAIL ADDRESS is suppressed.
 *
 * Same mechanism as `Stopped`, reached from the other side: `loadRunContext`
 * checks both identifiers and either one exits the run, so an unsubscribed
 * address blocks the texts every bit as completely as a texted STOP does.
 * Filing a consent row here and saying "you are all set" would be a promise
 * nothing can keep.
 *
 * It does NOT say "text START". That clears a phone suppression; hers is on
 * her email address, so following it would cost her a text message and leave
 * her exactly as blocked. There is no self-serve way back from an unsubscribe
 * in this codebase, so the page hands her to a person — the same answer
 * `Unavailable` gives, for the same reason.
 */
function Unsubscribed() {
  return (
    <div className="text-center">
      <h1 className="font-heading mb-4 text-2xl font-semibold text-primary">We cannot turn texts on here</h1>
      <p className="text-muted-foreground mb-3">
        Our records show you unsubscribed from our messages. We have kept that, so this page has not changed anything
        and nothing has been recorded.
      </p>
      <p className="text-muted-foreground mb-3">
        That covers our texts as well as our emails. Saying yes on this page would not actually let us text you, so we
        are not going to pretend otherwise.
      </p>
      <p className="text-muted-foreground text-sm">
        If you have changed your mind, reply to any email you already have from us and a person will sort it out.
      </p>
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
