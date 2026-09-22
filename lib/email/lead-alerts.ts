// lib/email/lead-alerts.ts -- the transactional mail a LEAD sets off, sent as
// the coach the lead belongs to rather than as this platform.
//
// NO BRAND NAMES ANYWHERE IN THIS FILE, comments included.
// `__tests__/lib/lead-engine/no-brand-literals.test.ts` sweeps it, the same way
// it sweeps the sequence engine, and for the same reason: these five messages
// are the first thing a stranger receives from a business, and the first thing
// a coach reads about a stranger. A hardcoded identity here is a second,
// un-migratable copy of one `getBusinessSettings()` already owns.
//
// WHY THESE FIVE AND NOT THE FORTY NEXT DOOR. lib/email.ts also sends password
// resets, verification links, welcome mail and the newsletter. Those go to this
// platform's OWN athletes, about this platform's own product, and they are
// correctly this platform's. These five are about somebody else's lead.
//
// EVERY ONE TAKES A `businessId` AND RESOLVES SETTINGS ITSELF. The alternative
// -- taking a pre-resolved settings row -- was rejected because four different
// call sites would each have had to remember to pass it, and the one that
// forgot would have had no compile error and no test failure, only a coach
// reading someone else's name.
//
// WHERE THE COACH IS ADDRESSED. `reply_to`, always, per decision 9. The
// funnel's `notify_emails` still ADDS recipients where a funnel sets them; it
// has never been the primary destination and this change does not make it one.

import type { BusinessSettings } from "@/lib/db/businesses"
import { getBusinessSettings } from "@/lib/db/businesses"
import { BusinessNotConfiguredError, alertRecipient, assertSendable, businessFrom } from "@/lib/email/business-identity"
import {
  ctaButton,
  escapeHtml,
  getBaseUrl,
  infoCard,
  resend,
  sectionLabel,
  tenantEmailLayout,
} from "@/lib/email/layout"

/**
 * Resolves the tenant and refuses early if they cannot lawfully send.
 *
 * Returns `null` instead of throwing when the row is unusable, so the two
 * senders whose contract is `{ delivered: boolean }` can keep that contract.
 * The WARNING is what makes the null honest: without it, an unconfigured
 * business and a business that simply had nothing to say are the same silence.
 */
async function resolveSender(
  businessId: string,
  context: string,
): Promise<{ settings: BusinessSettings; to: string } | null> {
  const settings = await getBusinessSettings(businessId)

  try {
    assertSendable(settings)
  } catch (err) {
    if (err instanceof BusinessNotConfiguredError) {
      console.warn(`[email] ${context}: business ${businessId} cannot send -- missing ${err.missing.join(", ")}`)
      return null
    }
    throw err
  }

  const to = alertRecipient(settings)
  if (!to) {
    // Distinct from the branch above and reported as its own line: "this
    // business may not send" and "this business has nobody to be told" have
    // different fixes, and collapsing them sends whoever is debugging to the
    // wrong field.
    console.warn(`[email] ${context}: business ${businessId} has no reply_to -- nobody was told`)
    return null
  }

  return { settings, to }
}

/**
 * Tells the coach a Red or Orange quiz result just came in.
 *
 * IT REPORTS WHETHER IT DELIVERED. The caller writes that flag onto the
 * attempt, so it has to be the truth: an attempt marked `sent` when nothing
 * left the building is worse than one marked `failed`, because nobody goes
 * looking for it. That is why an unconfigured tenant and a missing reply_to
 * both come back `false` here rather than throwing.
 *
 * Every visitor-typed string goes through `escapeHtml`.
 */
export async function sendQuizAlertEmail({
  businessId,
  name,
  email,
  phone,
  score,
  tierKey,
  tierHeadline,
  branchName,
  profileName,
  attemptId,
}: {
  businessId: string
  name: string
  email: string
  phone?: string | null
  score: number
  tierKey: string
  tierHeadline: string
  branchName: string | null
  profileName: string | null
  attemptId: string
}): Promise<{ delivered: boolean }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set -- skipping quiz alert for attempt ${attemptId}`)
    return { delivered: false }
  }

  const sender = await resolveSender(businessId, `quiz alert for attempt ${attemptId}`)
  if (!sender) return { delivered: false }
  const { settings, to } = sender

  const html = tenantEmailLayout(
    `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("Quiz Result")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            ${escapeHtml(name)} scored ${score} out of 100
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            ${escapeHtml(tierHeadline)}. Lower scores mean larger gaps, so this one is worth a conversation soon.
          </p>

          ${infoCard([
            { label: "Name", value: escapeHtml(name) },
            { label: "Email", value: escapeHtml(email) },
            { label: "Mobile", value: phone ? escapeHtml(phone) : "not given" },
            { label: "Result", value: `${escapeHtml(tierKey)} — ${score}/100` },
            { label: "Archetype", value: branchName ? escapeHtml(branchName) : "not sorted" },
            { label: "Profile", value: profileName ? escapeHtml(profileName) : "none" },
            { label: "Attempt", value: escapeHtml(attemptId) },
          ])}

        </td>
      </tr>
    </table>
  `,
    settings,
  )

  const { error } = await resend.emails.send({
    from: businessFrom(settings),
    to,
    replyTo: settings.reply_to,
    subject: `[Quiz] ${name} scored ${score}/100 — ${tierKey}`,
    html,
  })

  if (error) {
    console.error("Failed to send quiz alert email:", { message: error.message })
    return { delivered: false }
  }

  return { delivered: true }
}

/** One turn of a public chat transcript, as `sendChatEscalationEmail` needs it. */
export type ChatEscalationTurn = {
  role: "user" | "assistant"
  content: string
  created_at: string
}

/**
 * The chat assistant has run out of things the database can answer and has
 * handed the conversation to a person. This is the message that person reads.
 *
 * Built on `sendContactFormEmail`'s shape, with three deliberate departures:
 *
 *  1. **One destination, no CC.** It goes to THIS TENANT'S OWN
 *     `business_settings.reply_to`, read here rather than handed in, because
 *     that is the mailbox their inbox screen is already connected to. A
 *     hardcoded CC would be a second recipient nobody on this tenant
 *     configured, for a message that can contain a stranger's phone number
 *     typed into a public box.
 *  2. **No `replyTo`.** The visitor is anonymous. There may be no address to
 *     reply to at all, and guessing one would put the operator's answer in front
 *     of the wrong person.
 *  3. **It reports whether it delivered.** The caller decides what a visitor is
 *     promised on the strength of this flag, so it has to be the truth. The
 *     early key check below stays even though the shared wrapper reports a
 *     missing key as an `error`: that error would reach the `if (error)` arm
 *     and THROW, and this function's contract with its caller is
 *     `{ delivered: false }`, not an exception.
 *
 * A SETTINGS READ THAT FAILS IS ALLOWED TO THROW, and that is the fourth
 * departure. `{ delivered: false }` means "there was nobody to tell"; a
 * database that could not be reached is a different fault with a different
 * fix, and the caller records the two differently (`not_configured` against
 * `failed`). Collapsing them would hide an outage behind a settings message.
 *
 * Every string below except the labels is text an anonymous visitor typed, so
 * all of it goes through `escapeHtml`. This is the only place that happens in
 * the escalation path.
 */
export async function sendChatEscalationEmail({
  businessId,
  conversationId,
  summary,
  transcript,
  landingPath,
  contactId,
}: {
  businessId: string
  conversationId: string
  summary: string
  transcript: ChatEscalationTurn[]
  landingPath?: string | null
  contactId?: string | null
}): Promise<{ delivered: boolean }> {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY not set -- skipping chat escalation for conversation ${conversationId}`)
    return { delivered: false }
  }

  const sender = await resolveSender(businessId, `chat escalation for conversation ${conversationId}`)
  if (!sender) return { delivered: false }
  const { settings, to } = sender

  const baseUrl = getBaseUrl()
  const transcriptHtml =
    transcript.length === 0
      ? `<p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#a09b94; font-style:italic;">
           No messages were recorded on this conversation.
         </p>`
      : transcript
          .map(
            (turn) => `
      <tr>
        <td style="padding:0 0 18px;">
          <p style="margin:0 0 4px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
            ${turn.role === "user" ? "Visitor" : "Assistant"}
          </p>
          <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.7; white-space:pre-wrap;">
            ${escapeHtml(turn.content)}
          </p>
        </td>
      </tr>`,
          )
          .join("")

  const html = tenantEmailLayout(
    `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("Chat Handover")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            Someone asked for a person
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            The website assistant could not answer this from what it is allowed to see, so it handed the conversation
            over. The visitor has been told a person will follow up.
          </p>

          ${infoCard([
            { label: "Conversation", value: escapeHtml(conversationId) },
            { label: "Started on", value: escapeHtml(landingPath ?? "unknown page") },
            { label: "Contact record", value: contactId ? escapeHtml(contactId) : "none — visitor stayed anonymous" },
          ])}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  What they wanted
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${escapeHtml(summary)}
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:32px 0 12px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
            Full transcript
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${transcriptHtml}
          </table>

          ${ctaButton(`${baseUrl}/admin/chat/${encodeURIComponent(conversationId)}`, "Open this conversation")}

        </td>
      </tr>
    </table>
  `,
    settings,
  )

  const { error } = await resend.emails.send({
    from: businessFrom(settings),
    to,
    subject: `[Chat] Someone asked for a person — ${conversationId.slice(0, 8)}`,
    html,
  })

  if (error) {
    console.error("Failed to send chat escalation email:", error)
    throw new Error(`Failed to send chat escalation email: ${error.message}`)
  }

  return { delivered: true }
}
