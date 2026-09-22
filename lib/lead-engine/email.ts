// lib/lead-engine/email.ts — settings-driven email for the Lead Engine
// sequence engine.
//
// Every piece of business identity — sender name, display name, postal
// address, reply-to — comes from `settings: BusinessSettings`, a parameter,
// never a constant in this file. `renderSequenceEmail` is pure specifically
// so it is testable without a database and so a brand literal has nowhere
// to hide: `__tests__/lib/lead-engine/no-brand-literals.test.ts` scans this
// file (and the rest of `lib/lead-engine/`) on disk for exactly that.
//
// Do NOT import from `lib/email.ts`. That file is ~2,800 lines behind 40+
// senders and hardcodes this codebase's own operator brand throughout its
// layout. Only two patterns are borrowed from it here: the Resend SDK guard
// (below) and the general shape of a transactional HTML email.

import { Resend } from "resend"
import type { EnrolmentMetadata } from "@/lib/lead-engine/enrolment-metadata"
import { substituteMergeFields } from "@/lib/lead-engine/merge-fields"
import { resolvePalette } from "@/lib/funnels/sections/palettes"
import type { BusinessSettings } from "@/lib/db/businesses"
import { businessFrom } from "@/lib/email/business-identity"

const _resendClient = new Resend(process.env.RESEND_API_KEY)

/**
 * True iff `RESEND_API_KEY` is set and non-blank.
 *
 * Mirrors `smsEnvPresent` in lib/lead-engine/sms.ts: `assertSendable`
 * answers "has a human filled in `business_settings`?" (the DB-level
 * concern, checked once per tick before any run is claimed); this answers
 * "does THIS deployment actually have a Resend API key?" — an independent,
 * env-level concern. The sequence-tick runner's per-tick gate checks this
 * BEFORE claiming a `sequence_messages` row for a due email step, the same
 * way it already checks `smsEnvPresent()` for sms — see `EmailAvailability`
 * in lib/automation/sequence-tick-runner.ts.
 */
export function emailEnvPresent(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

// Mirrors the guard that used to live here: every callsite short-circuited
// when RESEND_API_KEY was missing by returning { data: null, error: null } —
// a "safe" failure indistinguishable from a successful send to every caller.
// sendRenderedSequenceEmail unwrapped that into { providerMessageId: null },
// and the sequence-tick runner then called markSent(messageId, "resend",
// null): a permanent "sent" row in sequence_messages for a message nothing
// ever transmitted, burning recordSend's one-shot (run_id, step_id) claim
// for good — the exact failure mode `sendRenderedSequenceSms` in
// lib/lead-engine/sms.ts documents for the identical pattern it used to
// share.
//
// `emailEnvPresent()` exists precisely so a caller can check this BEFORE
// claiming a sequence_messages row at all (the runner's EmailAvailability
// gate); this function still throws defensively for any caller that skips
// that check — a live env drift or a test that forgets to mock `resend`
// fails loud instead of silently fabricating a delivery.
const resend = {
  emails: {
    send: (async (args: Parameters<typeof _resendClient.emails.send>[0]) => {
      if (!emailEnvPresent()) {
        throw new Error(`sendRenderedSequenceEmail: RESEND_API_KEY not set`)
      }
      return _resendClient.emails.send(args)
    }) as typeof _resendClient.emails.send,
  },
}

/**
 * The exact sentence carrying the unsubscribe link, rendered into every
 * sequence email footer. Task 6 (consent revocation) stamps this same
 * constant into the NOT NULL `wording_shown` column on the consent row it
 * writes when a contact unsubscribes — the two must never drift, which is
 * why this is a shared export rather than a string duplicated in two
 * places.
 */
export const UNSUBSCRIBE_FOOTER_SENTENCE =
  "If you no longer want to receive these emails, you can unsubscribe at any time."

/**
 * The literal token a sequence step's stored `body` carries where the
 * per-contact SMS consent link belongs. Substituted here, at render time,
 * from the URL the caller supplies.
 *
 * The seed copy cannot hold the real URL and never could: the token is signed
 * per CONTACT (lib/lead-engine/sms-consent-token.ts) and the origin is per
 * DEPLOYMENT (lib/lead-engine/origin.ts), while `sequence_steps.body` is one
 * flat text column shared by every recipient. Same split as the unsubscribe
 * URL — this function stays pure, and the caller (the sequence-tick runner)
 * mints the URL.
 *
 * Migration 00226 puts this placeholder into the `sms_repermission` step body.
 */
export const SMS_CONSENT_URL_PLACEHOLDER = "{{sms_consent_url}}"

/**
 * The same token, written the way a PERSON might type it — with or without
 * spaces inside the braces, in any case.
 *
 * The merge-field rule (lib/lead-engine/merge-fields.ts) already tolerates all
 * of those, so the step editor calls `{{ sms_consent_url }}` a working token.
 * An exact-string match here would disagree with that: it would skip the guard
 * below and the substitution, and ship the braces as visible text.
 */
const SMS_CONSENT_TOKEN = /\{\{\s*sms_consent_url\s*\}\}/gi

/**
 * The link text shown in the HTML part where the placeholder sits.
 *
 * A short phrase rather than the raw URL, following the footer's own
 * `<a ...>Unsubscribe</a>`: a signed token is ~120 characters of base64url
 * and reads as noise in an inbox. The plain-text part still carries the bare
 * URL, because a text/plain reader has nothing to click.
 *
 * Not a brand string, and it must not become one —
 * `__tests__/lib/lead-engine/no-brand-literals.test.ts` sweeps this file.
 */
const SMS_CONSENT_LINK_LABEL = "Yes, you can text me"

/**
 * BOTH MOVED to lib/email/business-identity.ts and re-exported here.
 *
 * They left because a SECOND mail path now needs them: the transactional lead
 * alerts in lib/email/lead-alerts.ts send from the same tenant identity, and
 * they cannot import this file -- it builds its Resend client at module scope,
 * so importing it from a route would turn a missing API key into an
 * import-time crash. Copying the rule into that file instead would have given
 * this codebase two sendability gates free to drift apart, which is the one
 * outcome worth avoiding here.
 *
 * Re-exported rather than relocated at every call site so that every existing
 * importer -- the sequence-tick route, the tick runner and their suites -- is
 * untouched by the move.
 */
export { assertSendable, BusinessNotConfiguredError } from "@/lib/email/business-identity"

/**
 * A provider rejection that KEEPS ITS SHAPE.
 *
 * This used to be a bare `Error` carrying only `error.message`, so everything
 * downstream saw prose and nothing else. You cannot tell an unverified
 * sending domain from an undeliverable mailbox out of prose — and on
 * 2026-08-31 that cost all 73 `sms_repermission` runs, because a typo in one
 * settings field was handled as though 73 separate mailboxes had each
 * refused.
 *
 * `assertSendable` above cannot prevent that class of failure however much it
 * is widened: whether a domain is verified is a fact held at the PROVIDER,
 * not in this database. So the shape survives the throw instead, and
 * `classifySendFault` reads it.
 *
 * THE MESSAGE FORMAT IS DELIBERATELY UNCHANGED (`sendSequenceEmail failed: …`).
 * `sequence_runs.last_error` rows already in production start with it, and so
 * do assertions in the route-level suite.
 */
export class SequenceSendError extends Error {
  readonly providerErrorName: string | null
  readonly statusCode: number | null

  constructor(message: string, meta: { providerErrorName: string | null; statusCode: number | null }) {
    super(message)
    this.name = "SequenceSendError"
    this.providerErrorName = meta.providerErrorName
    this.statusCode = meta.statusCode
  }
}

/**
 * Faults that belong to THIS RECIPIENT and would fail identically on a retry.
 * Deliberately short — see `classifySendFault` for why the absent cases are
 * the safe ones to be missing.
 */
const RECIPIENT_FAULT_NAMES = new Set(["invalid_to_address", "invalid_recipient"])

/**
 * Whose fault is this — the configuration's, or the recipient's?
 *
 * *** THE DEFAULT IS "configuration", AND THAT IS THE POINT. ***
 *
 * A configuration fault (unverified domain, revoked key, suspended account,
 * exhausted quota, provider 5xx) fails every run in the batch identically and
 * self-heals the moment somebody fixes the setting. A recipient fault belongs
 * to one address and will fail the same way forever.
 *
 * Getting this backwards is NOT symmetric, which is why the default leans the
 * way it does:
 *
 *   - A recipient fault misread as configuration costs five deferred retries
 *     and then fails terminally anyway, because MAX_ATTEMPTS bounds it.
 *   - A configuration fault misread as a recipient fault DESTROYS THE
 *     CAMPAIGN. `recordSend` will not re-claim a `sequence_messages` row in
 *     status 'failed', so those runs have no way back in without a hand-run
 *     database repair. That is the 31 August failure exactly.
 *
 * So the recipient list is short and explicit, and everything unrecognised —
 * including every error Resend has not shipped yet — takes the bounded path.
 */
export function classifySendFault(err: unknown): "configuration" | "recipient" {
  if (!(err instanceof SequenceSendError)) return "configuration"
  if (err.providerErrorName && RECIPIENT_FAULT_NAMES.has(err.providerErrorName)) return "recipient"
  // 422 is "we understood the request and refused this value". It is the
  // recipient's fault only when the value refused IS the recipient — a 422
  // naming the `from` address is a configuration fault wearing the same code.
  if (err.statusCode === 422 && /\bto\b|recipient/i.test(err.message)) return "recipient"
  return "configuration"
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * The palette this layout has always used, and the answer for every tenant who
 * has not chosen one — which today is all of them
 * (`business_settings.brand_color` is NULL until a coach picks it, and
 * migration 00260 never defaults it).
 *
 * `strip` is the three-stop gradient on the top edge, and it exists only for
 * this default: a gradient needs a lighter MIDPOINT, and there is no honest way
 * to derive one for an arbitrary brand — so a tenant who has chosen a colour
 * gets a flat strip in it rather than a "gradient" whose three stops are all
 * the same value, which is a no-op wearing a gradient's clothes.
 *
 * Not brand NAMES, and they must not become any: this file is swept by
 * `__tests__/lib/lead-engine/no-brand-literals.test.ts`. A hex is a colour.
 */
const DEFAULT_PALETTE = {
  brand: "#0E3F50",
  /** What the wordmark is printed in ON the brand band. */
  brandInk: "#ffffff",
  accent: "#C49B7A",
  strip: "linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%)",
} as const

/**
 * `#rrggbb` and nothing else — the EXACT shape three other places already
 * enforce: `paletteSchema`'s `hexColor`, `POST /api/admin/businesses/brand`,
 * and migration 00260's own CHECK constraints. Anything shorter or longer
 * cannot be in the column, and accepting it here would be this file disagreeing
 * with the database about what a colour is.
 */
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/**
 * The tenant's palette, or the default above.
 *
 * VALIDATION IS THE GUARD, not escaping. These land inside a `style`
 * attribute, and `escapeHtml` would stop a quote breaking out — but
 * `red; background-image:url(https://tracker.example/x.png)` needs no quote at
 * all to add a second declaration, and an email that silently loads a remote
 * image is a tracking pixel somebody else chose. Anything that is not a hex
 * falls back to the whole default palette, which costs the wrong colours rather
 * than an injected rule.
 *
 * DERIVED BY `resolvePalette`, not by arithmetic invented here. That function
 * already owns two things this email needs and must not answer differently
 * from the same business's funnel pages: the contrast-correct INK for a
 * background (measured against both black and white, never thresholded — see
 * its own header), and the accent to use when a coach picks a brand colour and
 * leaves the accent NULL, which is the "derive it from the brand" state the
 * write route models explicitly. Without the first, a coach who picks a pale
 * brand gets their own name in white on near-white, invisible in every sequence
 * email; without the second, they get their brand band above the incumbent
 * tenant's gold strip.
 */
function paletteFor(settings: BusinessSettings): { brand: string; brandInk: string; accent: string; strip: string } {
  const brand = settings.brand_color?.trim() ?? ""
  if (!HEX_COLOUR.test(brand)) return DEFAULT_PALETTE

  const storedAccent = settings.accent_color?.trim() ?? ""
  const accent = HEX_COLOUR.test(storedAccent) ? storedAccent : undefined
  const tokens = resolvePalette({ brand, accent })
  return { brand: tokens.brand, brandInk: tokens.brandInk, accent: tokens.accent, strip: tokens.accent }
}

/**
 * Renders a sequence step's subject/body into a full email. Pure: no I/O,
 * no environment reads, no database. Every identifying string comes from
 * `args.settings`.
 */
export function renderSequenceEmail(args: {
  settings: BusinessSettings
  subject: string
  body: string
  /** Required whenever the unsubscribe footer is rendered (the default). */
  unsubscribeUrl?: string
  /**
   * The per-contact SMS consent page URL. Required only when `body` actually
   * contains `SMS_CONSENT_URL_PLACEHOLDER`; ignored otherwise, so a body
   * without the placeholder renders byte-for-byte the same whether this is
   * passed or not.
   */
  smsConsentUrl?: string
  contactName: string | null
  /**
   * What the enrolling event let this run remember (G10). Optional and
   * defaulted to `{}` so every existing caller renders byte-for-byte the same
   * — a step whose copy uses no metadata token cannot tell the difference.
   */
  enrolmentMetadata?: EnrolmentMetadata
  /**
   * Defaults to TRUE. Every message this engine sends to a CONTACT is a
   * commercial message and must carry the unsubscribe line, so opting out has
   * to be deliberate and explicit.
   *
   * Pass `false` only for internal operator notifications (the `alert` step).
   * Those are not commercial messages, and giving one an unsubscribe link is
   * actively dangerous: the link is signed for the LEAD the alert concerns,
   * the unsubscribe page writes on GET, and corporate mail scanners GET every
   * URL in an inbound message — so a scanner in the operator's inbox would
   * suppress that lead and write a falsified consent record for them.
   */
  includeUnsubscribeFooter?: boolean
}): { subject: string; html: string; text: string } {
  const { settings, unsubscribeUrl, smsConsentUrl, contactName } = args
  const includeUnsubscribeFooter = args.includeUnsubscribeFooter !== false
  if (includeUnsubscribeFooter && !unsubscribeUrl) {
    // An empty href does not satisfy CAN-SPAM. A caller that forgot the URL
    // must fail loudly rather than ship a commercial email whose unsubscribe
    // link goes nowhere.
    throw new Error("renderSequenceEmail: unsubscribeUrl is required unless includeUnsubscribeFooter is false")
  }
  const merge = { contactName, metadata: args.enrolmentMetadata ?? {} }
  const subject = substituteMergeFields(args.subject, merge)
  const body = substituteMergeFields(args.body, merge)

  // THE TENANT'S OWN COLOURS, falling back to the ones this layout has always
  // used. `business_settings.brand_color` / `.accent_color` are NULL until a
  // coach picks a palette (migration 00260, and `resolveBrandKit`'s own note
  // that NULL is never defaulted), so the fallbacks are not placeholders —
  // they are the answer for every tenant who has not chosen, which today is
  // all of them.
  //
  // VALIDATED, not interpolated blind. These land inside a `style` attribute,
  // and although `escapeHtml` would neutralise a quote, a value like
  // `red; background-image:url(...)` needs no quote at all to smuggle a second
  // declaration in. A strict hex test is the whole guard: anything else falls
  // back, which is a wrong colour rather than an injected rule.
  const { brand, brandInk, accent, strip } = paletteFor(settings)

  // MATCHED WITH THE SAME TOLERANCE THE EDITOR SHOWS. `{{ sms_consent_url }}`
  // with spaces is a token the merge-field rule calls known and working, so
  // the editor warns about nothing — while an exact `includes` would miss it,
  // skip both the throw below AND the substitution, and mail the braces out as
  // text on the one step whose entire purpose is that link. One regex, used for
  // the test and for both substitutions.
  const consentTokens = body.match(SMS_CONSENT_TOKEN) ?? []
  const wantsSmsConsentUrl = consentTokens.length > 0
  if (wantsSmsConsentUrl && !smsConsentUrl) {
    // The two alternatives are shipping `{{sms_consent_url}}` to a real
    // person as visible template syntax, or rendering a link that points
    // nowhere on the one page whose entire job is recording that they agreed.
    // Both are worse than a loud failure — and the runner always supplies the
    // URL, so this is unreachable from the send path.
    throw new Error("renderSequenceEmail: body contains {{sms_consent_url}} but no smsConsentUrl was supplied")
  }

  // Substituted AFTER escaping, not before, and only in the HTML part.
  // escapeHtml leaves `{` and `}` alone, so the placeholder survives it
  // intact — which means the anchor below is the only unescaped markup in an
  // otherwise fully escaped paragraph, and its href still runs through the
  // very same escapeHtml the unsubscribe href uses. Substituting the raw URL
  // BEFORE escaping would render it as visible text instead of a link.
  const withSmsConsentLink = (escaped: string): string =>
    wantsSmsConsentUrl
      ? escaped.replace(
          SMS_CONSENT_TOKEN,
          `<a href="${escapeHtml(smsConsentUrl as string)}" style="color:${brand}; text-decoration:underline;">${SMS_CONSENT_LINK_LABEL}</a>`,
        )
      : escaped

  const bodyParagraphsHtml = body
    .split(/\n{2,}/)
    .filter((para) => para.length > 0)
    .map(
      (para) =>
        `<p style="margin:0 0 18px; white-space:pre-line; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">${withSmsConsentLink(escapeHtml(para))}</p>`,
    )
    .join("\n")

  // Header band mirrors the house layout in lib/email.ts (dark #0E3F50 band
  // under a #C49B7A gradient strip) — the LAYOUT is shared visual identity;
  // the wordmark itself still comes only from `settings`.
  const headerHtml = settings.logo_url
    ? `<img src="${escapeHtml(settings.logo_url)}" alt="${escapeHtml(settings.display_name)}" style="max-height:48px; border:0; display:block; margin:0 auto;" />`
    : `<h1 style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:${brandInk}; letter-spacing:6px; text-transform:uppercase;">${escapeHtml(settings.display_name)}</h1>`

  // The footer's identity + unsubscribe lines render unconditionally for a
  // commercial message — a missing postal address is a CAN-SPAM violation, so
  // nothing here may be gated on personalization, body content, or any other
  // optional input. `includeUnsubscribeFooter: false` is the ONE exception and
  // it is not an optional input: it marks the message as an internal operator
  // notification rather than a message to a contact.
  const unsubscribeLineHtml = includeUnsubscribeFooter
    ? `\n    <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8; line-height:1.6;">${escapeHtml(UNSUBSCRIBE_FOOTER_SENTENCE)} <a href="${escapeHtml(unsubscribeUrl as string)}" style="color:${brand}; text-decoration:underline;">Unsubscribe</a></p>`
    : ""
  const footerHtml = `
    <p style="margin:0 0 6px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:${accent}; letter-spacing:3px; text-transform:uppercase;">${escapeHtml(settings.display_name)}</p>
    <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#a09b94; letter-spacing:0.5px;">Sent by ${escapeHtml(settings.sender_name)} &middot; ${escapeHtml(settings.postal_address)}</p>${unsubscribeLineHtml}
  `.trim()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:#edece8; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#5c5750; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edece8;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:2px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06);">
          <tr>
            <td style="height:3px; background:${accent}; background-image:${strip}; font-size:0; line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="background-color:${brand}; padding:30px 48px;">
              ${headerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:40px 48px 24px;">
              ${bodyParagraphsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 48px 32px; background-color:#faf9f7; border-top:1px solid #edece8;">
              ${footerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()

  // The text/plain part gets the bare URL: there is nothing to click in a
  // plain-text reader, so the label would leave that reader with no way to
  // reach the page at all.
  const bodyText = wantsSmsConsentUrl ? body.replace(SMS_CONSENT_TOKEN, smsConsentUrl as string) : body

  const text = [
    bodyText,
    "",
    "---",
    settings.display_name,
    `Sent by ${settings.sender_name} · ${settings.postal_address}`,
    ...(includeUnsubscribeFooter ? [`${UNSUBSCRIBE_FOOTER_SENTENCE} ${unsubscribeUrl}`] : []),
  ].join("\n")

  return { subject, html, text }
}

export type RenderedSequenceEmail = { subject: string; html: string; text: string }

/**
 * Sends an ALREADY-RENDERED sequence email via Resend.
 *
 * Split out from `sendSequenceEmail` so a caller that needs the rendered
 * output for its own purposes — `sequence-tick-runner.ts` records it on the
 * `sequence_messages` row, because `body_rendered` must hold what was actually
 * sent rather than the template it came from — can render once and send the
 * very same bytes, instead of rendering twice and hoping the two agree.
 */
export async function sendRenderedSequenceEmail(args: {
  to: string
  rendered: RenderedSequenceEmail
  settings: BusinessSettings
  unsubscribeUrl?: string
  oneClickUrl?: string
  includeUnsubscribeFooter?: boolean
}): Promise<{ providerMessageId: string | null }> {
  const { settings, rendered } = args
  const includeUnsubscribeFooter = args.includeUnsubscribeFooter !== false

  const { data, error } = await resend.emails.send({
    from: businessFrom(settings),
    to: args.to,
    replyTo: settings.reply_to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // No List-Unsubscribe headers on an internal notification: the header
    // would carry a revocation URL for a THIRD PARTY (the lead the alert is
    // about), and a mail client's unsubscribe button — or a scanner — would
    // fire it on the operator's behalf.
    //
    // RFC 8058: `List-Unsubscribe-Post` obliges the URI in `List-Unsubscribe`
    // to accept an HTTPS POST, so the two move together and the header points
    // at the POST endpoint rather than the page. Without a one-click endpoint
    // we still advertise unsubscription, but we do not claim a capability the
    // URI does not have.
    headers: includeUnsubscribeFooter
      ? {
          "List-Unsubscribe": `<${args.oneClickUrl ?? args.unsubscribeUrl}>`,
          ...(args.oneClickUrl ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
        }
      : undefined,
  })

  if (error) {
    // The shape is preserved, not just the sentence — see SequenceSendError.
    // Resend's error object carries `name` (e.g. "validation_error") and
    // `statusCode`; both used to be discarded here, which left
    // classifySendFault nothing to read but prose.
    const meta = error as { name?: string; statusCode?: number }
    throw new SequenceSendError(`sendSequenceEmail failed: ${error.message}`, {
      providerErrorName: meta.name ?? null,
      statusCode: meta.statusCode ?? null,
    })
  }

  return { providerMessageId: data?.id ?? null }
}

/**
 * Renders and sends one sequence email via Resend.
 *
 * Convenience wrapper over `renderSequenceEmail` + `sendRenderedSequenceEmail`
 * for callers with nothing to do with the rendered output (the `alert` step).
 */
export async function sendSequenceEmail(args: {
  to: string
  subject: string
  body: string
  /**
   * The human link rendered in the footer — a browser GET lands on a page.
   * Required unless `includeUnsubscribeFooter` is false.
   */
  unsubscribeUrl?: string
  /**
   * The RFC 8058 one-click endpoint, which must accept an HTTPS POST. Supply
   * it and the message declares `List-Unsubscribe-Post`; omit it and the
   * message carries a plain `List-Unsubscribe` only. Declaring one-click
   * against a GET-only page is what made Gmail's unsubscribe button answer
   * 405.
   */
  oneClickUrl?: string
  contactName: string | null
  settings: BusinessSettings
  /**
   * Defaults to TRUE. `false` marks this as an internal operator
   * notification: no unsubscribe footer AND no List-Unsubscribe headers. An
   * ops email is not a commercial message, and must not carry a one-click
   * revocation for somebody else's consent.
   */
  includeUnsubscribeFooter?: boolean
}): Promise<{ providerMessageId: string | null }> {
  const settings = args.settings

  const includeUnsubscribeFooter = args.includeUnsubscribeFooter !== false

  const rendered = renderSequenceEmail({
    settings,
    subject: args.subject,
    body: args.body,
    unsubscribeUrl: args.unsubscribeUrl,
    contactName: args.contactName,
    includeUnsubscribeFooter,
  })

  return sendRenderedSequenceEmail({
    to: args.to,
    rendered,
    settings,
    unsubscribeUrl: args.unsubscribeUrl,
    oneClickUrl: args.oneClickUrl,
    includeUnsubscribeFooter,
  })
}
