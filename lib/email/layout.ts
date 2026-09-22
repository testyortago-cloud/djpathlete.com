// lib/email/layout.ts -- the shared chrome behind every email this app sends.
//
// MOVED HERE, NOT REWRITTEN. `client()`, the `resend` wrapper, `emailLayout`
// and the small presentational helpers below all used to be module-private in
// lib/email.ts. They were lifted out verbatim so that the tenant-aware lead
// alerts (lib/email/lead-alerts.ts) can reuse the same chrome without
// importing that file -- which would have made a cycle, because lib/email.ts
// re-exports those senders for its existing callers.
//
// `emailLayout` gained ONE new thing in the move: an optional `branding`
// argument. With no branding it renders exactly what it rendered before, which
// is what every app email to this platform's own athletes still wants. With
// branding it renders that tenant\'s identity instead -- see
// `tenantEmailLayout` at the bottom, which is the only door the lead alerts
// use and which cannot be called without it.

import { Resend } from "resend"
import type { BusinessSettings } from "@/lib/db/businesses"

// Built per send, INSIDE the wrapper below, never at module scope. The SDK's
// own constructor throws synchronously when no key is available
// (node_modules/resend/dist/index.mjs: `if (!this.key) throw new Error(
// "Missing API key. ...")`), so a module-scope client would mean an unset
// RESEND_API_KEY takes down every route that imports this file at IMPORT time,
// before the guard below could run — and would leave that guard reachable only
// under a mocked SDK. Constructing after the guard is what makes the guard a
// guard. Same reasoning, same shape, as lib/email/sender-domains.ts.
//
// Deliberately not memoised: the client is a thin holder of headers and
// endpoint wrappers, so the allocation is nothing next to the network call it
// is about to make, and nothing can go stale.
export function client(): Resend {
  return new Resend(process.env.RESEND_API_KEY)
}

// Wrap the SDK so a missing API key is reported as a SEND ERROR rather than as
// a successful send. It used to return `{ data: null, error: null }` — the
// exact shape of a delivered message — so a sender below that reads `error`
// reported success for something nothing transmitted. Each of them already
// logs or throws on `error`, so a missing key now says so out loud through the
// path each sender already has. Two exceptions, both unchanged by this:
// `sendChatEscalationEmail` and `sendQuizAlertEmail` check the key themselves
// before calling in, and have always answered `{ delivered: false }`. The four
// event-signup senders discard the send result and are unaffected either way.
//
// What this branch is, honestly: an alarm for env drift, not a routine path.
// Production has the key, and so do tests — `vitest.config.ts` sets a
// placeholder — so a suite only reaches this branch by deleting the key on
// purpose. What keeps a suite that forgot to mock `resend` off the live API is
// not this guard but __tests__/setup.tsx's global mock of the module.
//
// Both `emails.send` (single) and `batch.send` (bulk newsletter) are wrapped
// so the same env-key guard applies uniformly.
export const resend = {
  emails: {
    send: (async (args: Parameters<Resend["emails"]["send"]>[0]) => {
      if (!process.env.RESEND_API_KEY) {
        console.warn(`[email] RESEND_API_KEY not set — skipping "${args.subject}"`)
        return {
          data: null,
          error: {
            name: "missing_api_key",
            message: `RESEND_API_KEY is not set — "${args.subject}" was not sent`,
          },
        } as Awaited<ReturnType<Resend["emails"]["send"]>>
      }
      return client().emails.send(args)
    }) as Resend["emails"]["send"],
  },
  batch: {
    send: (async (args: Parameters<Resend["batch"]["send"]>[0]) => {
      if (!process.env.RESEND_API_KEY) {
        const count = Array.isArray(args) ? args.length : 0
        console.warn(`[email] RESEND_API_KEY not set — skipping batch of ${count}`)
        return {
          data: null,
          error: {
            name: "missing_api_key",
            message: `RESEND_API_KEY is not set — a batch of ${count} was not sent`,
          },
        } as Awaited<ReturnType<Resend["batch"]["send"]>>
      }
      return client().batch.send(args)
    }) as Resend["batch"]["send"],
  },
}

export function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

/**
 * WHOSE EMAIL THIS IS. Every field here comes from one tenant's
 * `business_settings` row, and nothing in this type has a default: a caller
 * that cannot name the business does not pass branding at all and gets the
 * platform's own chrome, which is what an app email to this platform's own
 * athletes wants.
 */
export type EmailBranding = {
  /** `business_settings.display_name` -- the wordmark and the copyright line. */
  displayName: string
  /** `business_settings.logo_url`. Null is ordinary: the wordmark is the fallback. */
  logoUrl: string | null
  /** `business_settings.sender_name` -- the human the footer says this came from. */
  senderName: string
  /**
   * `business_settings.postal_address`. Rendered unconditionally in a branded
   * footer: CAN-SPAM requires a physical address in a commercial message, and
   * `assertSendable` in ./business-identity refuses to send without one.
   */
  postalAddress: string
}

/**
 * Shared email wrapper with branded header + footer.
 *
 * With no `branding` this renders the platform's own identity, unchanged from
 * before this argument existed -- that is the path all ~35 app emails in
 * lib/email.ts take. With `branding` it renders that tenant's identity and
 * drops the two things that are the platform's rather than the sender's: the
 * strapline under the wordmark, and the footer nav pointing at this platform's
 * own marketing pages.
 */
export function emailLayout(content: string, branding?: EmailBranding) {
  const baseUrl = getBaseUrl()
  const brandName = branding ? escapeHtml(branding.displayName) : "DJP Athlete"

  // A logo when the tenant has uploaded one, their name set as the wordmark
  // otherwise. `logo_url` is nullable and a null is ordinary, not a fault --
  // `assertSendable` deliberately does not require it, because a business with
  // a name and no logo can still send a lawful, identifiable email.
  const headerMarkHtml =
    branding && branding.logoUrl?.trim()
      ? `<img src="${escapeHtml(branding.logoUrl.trim())}" alt="${brandName}" style="max-height:56px; border:0; display:block; margin:0 auto;" />`
      : `<h1 style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:28px; font-weight:400; color:#ffffff; letter-spacing:8px; text-transform:uppercase;">${brandName}</h1>`

  // The strapline and the footer nav are the PLATFORM\'s, not the sender\'s.
  // `/programs`, `/online`, `/blog` and `/contact` are this platform\'s own
  // marketing pages -- a coach\'s lead reading their alert has no business
  // being sent to them, so a branded email drops both rather than relabelling
  // them.
  const straplineHtml = branding
    ? ""
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                      <tr>
                        <td style="width:24px; border-bottom:1px solid rgba(196,155,122,0.4);"></td>
                        <td style="padding:0 12px;">
                          <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:#C49B7A; letter-spacing:4px; text-transform:uppercase;">
                            Elite Performance
                          </p>
                        </td>
                        <td style="width:24px; border-bottom:1px solid rgba(196,155,122,0.4);"></td>
                      </tr>
                    </table>`

  const footerNavHtml = branding
    ? ""
    : `<!-- Footer nav -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="padding-bottom:24px;">
                          <a href="${baseUrl}/programs" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Programs</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/online" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Coaching</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/blog" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Blog</a>
                          <span style="color:#d4cfc8; font-size:10px;">&bull;</span>
                          <a href="${baseUrl}/contact" style="font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:12px; color:#0E3F50; text-decoration:none; letter-spacing:1px; text-transform:uppercase; padding:0 14px;">Contact</a>
                        </td>
                      </tr>
                    </table>`

  // CAN-SPAM: a physical postal address in every commercial message. It rides
  // with the branding rather than with the content because it identifies the
  // SENDER, and only a branded email knows who that is. The unbranded path
  // keeps the footer it has always had.
  const identityLineHtml = branding
    ? `
                          <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#a09b94; letter-spacing:0.5px;">
                            Sent by ${escapeHtml(branding.senderName)} &middot; ${escapeHtml(branding.postalAddress)}
                          </p>`
    : ""
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${brandName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Exa:wght@400;600;700&family=Lexend+Deca:wght@300;400;500&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#edece8; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edece8;">
    <tr>
      <td align="center" style="padding:48px 16px;">

        <!-- Pre-header spacer with brand line -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:40px; border-bottom:2px solid #C49B7A;"></td>
                  <td style="padding:0 16px;">
                    <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:11px; color:#8a8680; letter-spacing:3px; text-transform:uppercase;">
                      ${brandName}
                    </p>
                  </td>
                  <td style="width:40px; border-bottom:2px solid #C49B7A;"></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Email container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:2px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.04), 0 20px 60px rgba(14,63,80,0.06);">

          <!-- ===== HEADER ===== -->
          <tr>
            <td style="background-color:#0E3F50; padding:0;">
              <!-- Top accent line -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:3px; background: linear-gradient(90deg, #C49B7A 0%, #d4b08e 50%, #C49B7A 100%);"></td>
                </tr>
              </table>
              <!-- Logo area -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:44px 48px 40px;">
                    ${headerMarkHtml}
                    ${straplineHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== BODY ===== -->
          <tr>
            <td style="padding:0;">
              ${content}
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td style="padding:0;">
              <!-- Pre-footer accent -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 48px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="border-top:1px solid #e8e5e0;"></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Footer content -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:32px 48px 40px;">
                    ${footerNavHtml}
                    <!-- Copyright -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center">
                          <p style="margin:0 0 6px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#a09b94; letter-spacing:0.5px;">
                            &copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.
                          </p>${identityLineHtml}
                          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8;">
                            <a href="${baseUrl}/privacy-policy" style="color:#a09b94; text-decoration:underline;">Privacy Policy</a>
                            &nbsp;&middot;&nbsp;
                            <a href="${baseUrl}/terms-of-service" style="color:#a09b94; text-decoration:underline;">Terms of Service</a>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Email container -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`
}

/** Premium CTA button helper */
export function ctaButton(href: string, label: string, variant: "primary" | "secondary" = "primary") {
  if (variant === "secondary") {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="border:2px solid #0E3F50; border-radius:2px;">
          <a href="${href}" target="_blank" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; font-weight:600; color:#0E3F50; text-decoration:none; padding:12px 32px; letter-spacing:1.5px; text-transform:uppercase;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`
  }
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="background-color:#0E3F50; border-radius:2px;">
        <a href="${href}" target="_blank" style="display:inline-block; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none; padding:14px 40px; letter-spacing:1.5px; text-transform:uppercase;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

/** Premium info card helper */
export function infoCard(rows: { label: string; value: string; valueColor?: string }[]) {
  const rowsHtml = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:${i === 0 ? "0" : "16px"} 0 ${i === rows.length - 1 ? "0" : "16px"}; ${i > 0 ? "border-top:1px solid #eae7e2;" : ""}">
          <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
            ${r.label}
          </p>
          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; font-weight:600; color:${r.valueColor ?? "#0E3F50"};">
            ${r.value}
          </p>
        </td>
      </tr>`,
    )
    .join("")

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
    <tr>
      <td style="padding:24px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${rowsHtml}
        </table>
      </td>
    </tr>
  </table>`
}

/** Section heading accent */
export function sectionLabel(text: string) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
    <tr>
      <td style="border-bottom:2px solid #C49B7A; padding-bottom:8px;">
        <p style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; font-weight:400; color:#C49B7A; letter-spacing:3px; text-transform:uppercase;">
          ${text}
        </p>
      </td>
    </tr>
  </table>`
}

/** Fallback link block */
export function fallbackLink(url: string) {
  return `
  <p style="margin:28px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:11px; color:#b5b0a8; line-height:1.6;">
    Button not working? Copy and paste this link:<br />
    <a href="${url}" style="color:#0E3F50; word-break:break-all; font-size:11px;">${url}</a>
  </p>`
}

/** Friendly nudge to whitelist us so future emails don't get junked. */
export function junkFolderNote() {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
    <tr>
      <td style="background-color:#fbf8f3; border-left:3px solid #C49B7A; padding:14px 18px; border-radius:4px;">
        <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:12px; color:#5c5750; line-height:1.6;">
          <strong style="color:#0E3F50;">Don't see our emails?</strong>
          Check your spam or junk folder and mark this message as <em>not spam</em> so future updates land in your inbox.
        </p>
      </td>
    </tr>
  </table>`
}

/** Hero banner for email types that have one */
export function heroBanner(label: string, headline: string) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="background-color:#0E3F50; padding:36px 48px; text-align:center;">
        <p style="margin:0 0 10px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:10px; color:#C49B7A; letter-spacing:4px; text-transform:uppercase;">
          ${label}
        </p>
        <h2 style="margin:0; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:24px; font-weight:400; color:#ffffff; line-height:1.3;">
          ${headline}
        </h2>
      </td>
    </tr>
  </table>`
}

/**
 * Escapes HTML special characters in free text before interpolating it into
 * an email template literal. Defense-in-depth for user-submitted (and
 * AI-generated, which may echo user input) content rendered as HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * THE ONLY DOOR THE TENANT-AWARE SENDERS USE.
 *
 * It exists so that "forgot to pass branding" is a compile error rather than a
 * silent fall-through to the platform\'s own wordmark -- which is exactly the
 * failure the brand-literal sweep over lib/email/lead-alerts.ts cannot see,
 * because the literal would live in THIS file, which the sweep does not scan.
 *
 * Takes the whole settings row rather than four strings so there is no second
 * place that decides which column means what.
 */
export function tenantEmailLayout(content: string, settings: BusinessSettings): string {
  return emailLayout(content, {
    displayName: settings.display_name,
    logoUrl: settings.logo_url,
    senderName: settings.sender_name,
    postalAddress: settings.postal_address,
  })
}
