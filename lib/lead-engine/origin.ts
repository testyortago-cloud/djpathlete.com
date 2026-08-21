// lib/lead-engine/origin.ts — the public origin every Lead Engine outbound
// link is built from: unsubscribe links and List-Unsubscribe headers in
// outbound mail (lib/automation/sequence-tick-runner.ts), and the Twilio SMS
// status callback URL (lib/lead-engine/sms.ts's `statusCallbackUrl`,
// verified against on the way back in by
// app/api/webhooks/twilio/status/route.ts). Both callers need this exact
// same origin — the SMS status callback URL the runner mints and the URL
// this app reconstructs to verify Twilio's signature on the callback must
// agree bit-for-bit, or every signature check fails.
//
// Extracted from lib/automation/sequence-tick-runner.ts (its original home,
// Task 8/Stage 1) so the Twilio status webhook — which has no reason to pull
// in the sequence-tick runner's much larger, DB-heavy module graph — can use
// it too. lib/automation/sequence-tick-runner.ts re-exports `appOrigin` from
// here so existing imports of it (notably
// __tests__/lib/automation/sequence-tick-origin.test.ts) keep working
// unchanged.

/**
 * The public origin every unsubscribe link, every List-Unsubscribe header,
 * and the Twilio SMS status-callback URL in this engine's outbound traffic
 * is built from.
 *
 * The chain is NEXTAUTH_URL -> NEXT_PUBLIC_APP_URL -> APP_URL, matching every
 * other email-link builder in this repo (lib/url.ts, lib/email.ts,
 * lib/shop/emails.ts, lib/messaging/email-new-message.ts). It used to read
 * `APP_URL ?? NEXT_PUBLIC_SITE_URL` with a localhost fallback, and both of
 * those reads miss in the runtime this code executes in: .env.example:124
 * states plainly that "Next.js server-side code reads NEXTAUTH_URL; APP_URL is
 * Firebase-side only", and NEXT_PUBLIC_SITE_URL is declared nowhere at all.
 * So every unsubscribe link shipped pointing at http://localhost:3050.
 *
 * THROWS rather than defaulting. A path that mints links for mail (or SMS)
 * leaving the building must fail loudly when it does not know where it
 * lives — a silent localhost default produces a dead unsubscribe link in a
 * real inbox, which is both a CAN-SPAM problem and invisible until someone
 * complains. The same reasoning applies to the Twilio status callback URL:
 * a localhost default there would mean Twilio can never reach this app at
 * all, and would fail the signature check on the way back in even if it
 * somehow could.
 *
 * Exported for __tests__/lib/automation/sequence-tick-origin.test.ts (via
 * the runner's re-export).
 */
export function appOrigin(): string {
  const candidates = [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL]
  // Trimmed-emptiness, not `??`: an env var set to "" is configured-as-blank,
  // and passing it through would mint a relative "/unsubscribe/<token>" URL
  // that resolves against the recipient's mail client, not against this app.
  const explicit = candidates.find((value) => typeof value === "string" && value.trim().length > 0)
  if (!explicit) {
    throw new Error(
      "no public origin configured: set NEXTAUTH_URL (or NEXT_PUBLIC_APP_URL / APP_URL). " +
        "Refusing to mint a localhost link for outbound mail or SMS.",
    )
  }
  return explicit.trim().replace(/\/+$/, "")
}
