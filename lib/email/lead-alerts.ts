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
  heroBanner,
  infoCard,
  resend,
  sectionLabel,
  tenantEmailLayout,
} from "@/lib/email/layout"
import type { LeadAnalysisResult } from "@/lib/ai/lead-analysis"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"

/**
 * THE ONE SINGLE-TENANT ASSUMPTION LEFT IN THIS FILE, named out loud rather
 * than hidden behind an import, because the brand sweep over this file cannot
 * see it: it is a URL, not a word, and no regex for an operator name will ever
 * catch it.
 *
 * It is the booking widget belonging to the business that owns this
 * deployment, offered in the auto-reply below to every applicant regardless of
 * whose coaching they applied for. G30 was scoped to the sender identity and
 * the layout, so it is unchanged here -- but it IS a live gap: another coach's
 * applicant is currently invited into this platform's own diary.
 *
 * What closing it needs is a per-tenant scheduling URL, and there is already a
 * column for one -- `coach_calendar_connections.scheduling_url`, read today by
 * lib/calendly/config-for-business.ts, which resolves a business's own
 * connection and deliberately gives a business without one NOTHING rather than
 * this platform's calendar. That is the shape this CTA wants: the tenant's own
 * link, or no button at all.
 */
const PLATFORM_BOOKING_LINK = "https://api.leadconnectorhq.com/widget/booking/p9XdK6uz9EC3JKUhpzdA"

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
 * Reads the tenant and refuses, by THROWING, if they cannot lawfully send.
 *
 * The twin of `resolveSender` above, for the senders whose contract is an
 * exception rather than a flag. Same gate, opposite report: their callers
 * already catch, and a caller that catches learns more from the field name in
 * the message than from a boolean.
 */
async function loadSendableSettings(businessId: string): Promise<BusinessSettings> {
  const settings = await getBusinessSettings(businessId)
  assertSendable(settings)
  return settings
}

/**
 * The coach's own mailbox, or a refusal naming the field that is empty.
 *
 * Separate from `assertSendable` because it answers a different question --
 * "where does this alert GO" rather than "may this tenant send at all" -- and
 * because the auto-reply below needs the first without the second.
 */
function requireAlertRecipient(settings: BusinessSettings): string {
  const to = alertRecipient(settings)
  if (!to) throw new BusinessNotConfiguredError(["reply_to"])
  return to
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

const PRIORITY_STYLES: Record<LeadAnalysisResult["priority"], { bg: string; color: string; label: string }> = {
  high: { bg: "#dcfce7", color: "#166534", label: "High Priority" },
  medium: { bg: "#fef3c7", color: "#92400e", label: "Medium Priority" },
  low: { bg: "#ede9e3", color: "#78736c", label: "Low Priority" },
}

/**
 * Tells the coach somebody applied.
 *
 * IT THROWS ON A PROVIDER ERROR, and on a tenant that cannot lawfully send.
 * Its caller catches and logs, which is the right shape for a message the lead
 * capture has already survived without -- but a silent fall-through to a send
 * with an empty From would be marked `failed` at the provider forever with no
 * re-activation path, so the refusal happens here.
 *
 * `replyTo` IS THE APPLICANT, not the tenant's own address. Hitting reply on
 * this alert answers the person who applied; pointed at the coach's own inbox
 * it would mail them their own alert back.
 */
export async function sendInquiryEmail({
  businessId,
  name,
  email,
  phone,
  serviceLabel,
  sport,
  experience,
  goals,
  injuries,
  how_heard,
  aiAnalysis,
}: {
  businessId: string
  name: string
  email: string
  phone?: string | null
  serviceLabel: string
  sport?: string | null
  experience?: string | null
  goals: string
  injuries?: string | null
  how_heard?: string | null
  aiAnalysis?: LeadAnalysisResult | null
}) {
  const settings = await loadSendableSettings(businessId)
  const to = requireAlertRecipient(settings)

  const infoRows: { label: string; value: string }[] = [
    { label: "Name", value: escapeHtml(name) },
    { label: "Email", value: escapeHtml(email) },
    { label: "Service", value: escapeHtml(serviceLabel) },
  ]
  if (phone) infoRows.push({ label: "Phone", value: escapeHtml(phone) })
  if (sport) infoRows.push({ label: "Sport", value: escapeHtml(sport) })
  if (experience) infoRows.push({ label: "Experience", value: escapeHtml(experience) })
  if (how_heard) infoRows.push({ label: "How They Heard About Us", value: escapeHtml(how_heard) })

  const firstName = name.split(" ")[0]
  const priorityStyle = aiAnalysis ? PRIORITY_STYLES[aiAnalysis.priority] : null

  const aiSectionHtml = aiAnalysis
    ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
            <tr>
              <td>
                <span style="display:inline-block; background-color:${priorityStyle!.bg}; color:${priorityStyle!.color}; font-size:11px; font-weight:600; padding:4px 14px; border-radius:2px; letter-spacing:0.5px;">
                  ${priorityStyle!.label}
                </span>
                <p style="margin:8px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#5c5750; line-height:1.7;">
                  ${escapeHtml(aiAnalysis.priority_reason)}
                </p>
              </td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #0E3F50;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Suggested Reply
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${escapeHtml(aiAnalysis.draft_reply)}
                </p>
              </td>
            </tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
            <tr>
              <td style="padding-right:12px;">
                ${ctaButton(
                  escapeHtml(
                    buildLeadMailtoLink({
                      email,
                      subject: `Re: Your ${serviceLabel} Application`,
                      body: aiAnalysis.draft_reply,
                    }),
                  ),
                  `Email ${firstName}`,
                )}
              </td>
              ${phone ? `<td>${ctaButton(buildTelLink(phone), `Call ${firstName}`, "secondary")}</td>` : ""}
            </tr>
          </table>
    `
    : `
          <p style="margin:32px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94;">
            Reply directly to <a href="mailto:${email}" style="color:#0E3F50; text-decoration:underline;">${email}</a>
          </p>
    `

  const html = tenantEmailLayout(
    `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel(`New ${serviceLabel} Application`)}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            New Inquiry
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            A potential client has submitted an application for <strong style="color:#0E3F50;">${serviceLabel}</strong>.
          </p>

          ${infoCard(infoRows)}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Goals
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${escapeHtml(goals)}
                </p>
              </td>
            </tr>
          </table>

          ${
            injuries
              ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Injuries / Limitations
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${escapeHtml(injuries)}
                </p>
              </td>
            </tr>
          </table>
          `
              : ""
          }

          ${aiSectionHtml}

        </td>
      </tr>
    </table>
  `,
    settings,
  )

  const { error } = await resend.emails.send({
    from: businessFrom(settings),
    to,
    replyTo: email,
    subject: `[Inquiry] New ${serviceLabel} Application — ${name}`,
    html,
  })

  if (error) {
    console.error("Failed to send inquiry email:", error)
    throw new Error("Failed to send inquiry email")
  }
}

/**
 * Tells the applicant their application arrived.
 *
 * THE ONE OF THE FIVE WHOSE RECIPIENT IS NOT THE COACH, which is why `to` is
 * still a parameter here and is read from settings everywhere else: the
 * destination is the person who just typed their address into a form.
 *
 * That is also why a blank `reply_to` does NOT stop it. For the four coach
 * alerts `reply_to` IS the destination, so a blank one means nobody to tell.
 * Here it is a courtesy header, and refusing to send would leave a person who
 * just applied with silence in order to fix a field that is not in the way.
 * `assertSendable` still applies: this is a commercial message to a member of
 * the public and it needs a postal address on it.
 */
export async function sendInquiryAutoReply({
  businessId,
  to,
  firstName,
  serviceLabel,
}: {
  businessId: string
  to: string
  firstName: string
  serviceLabel: string
}) {
  const settings = await loadSendableSettings(businessId)
  const replyTo = alertRecipient(settings)

  const html = tenantEmailLayout(
    `
    ${heroBanner("Application Received", `We&rsquo;re excited to hear from you, ${firstName}.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          <p style="margin:0 0 24px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            Thanks for applying for <strong style="color:#0E3F50;">${serviceLabel}</strong>. We&rsquo;ve received your application and our team will review it shortly.
          </p>

          <p style="margin:0 0 32px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:16px; color:#5c5750; line-height:1.8;">
            The next step is to schedule a consultation call so we can learn more about your goals and create a plan tailored to you.
          </p>

          ${ctaButton(PLATFORM_BOOKING_LINK, "Schedule Your Consultation")}

          <p style="margin:36px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#a09b94; line-height:1.7;">
            Looking forward to working with you,<br />
            <strong style="color:#0E3F50;">${escapeHtml(settings.sender_name)}</strong><br />
            ${escapeHtml(settings.display_name)}
          </p>

        </td>
      </tr>
    </table>
  `,
    settings,
  )

  const { error } = await resend.emails.send({
    from: businessFrom(settings),
    to,
    ...(replyTo ? { replyTo } : {}),
    subject: `Your ${serviceLabel} application — ${settings.display_name}`,
    html,
  })

  if (error) {
    console.error("Failed to send inquiry auto-reply:", error)
    throw new Error("Failed to send inquiry auto-reply")
  }
}

export interface NewFunnelLeadEmailInput {
  name: string | null
  email: string | null
  phone: string | null
  pageName: string
  /** Everything the visitor typed, keyed by field name. */
  answers: Record<string, unknown>
  /** Absolute link into the leads inbox. */
  leadsUrl: string
  /** WHOSE funnel this is. Decides the sender identity and the destination. */
  businessId: string
  /**
   * Extra recipients set on the funnel itself, ADDED TO the coach's own
   * `reply_to` rather than replacing it. A per-funnel list is "also tell these
   * people", never "instead of the coach" — a camp handed to an assistant must
   * not stop reaching the person who owns the inbox.
   *
   * Decision 9 changed which address goes first; it did not take this away.
   */
  extraRecipients?: string[] | null
}

/**
 * Tells the coach a lead just came in.
 *
 * WHY IT EXISTS. Funnel submissions were captured to `funnel_submissions` and
 * nothing anywhere was told. The lead sat in a table nothing read until someone
 * happened to open a page that did not exist yet — which, for a campaign page
 * driving paid traffic, is how a lead becomes a lost lead.
 *
 * EVERY VISITOR-SUPPLIED VALUE IS ESCAPED. The answers come from a public form
 * on a public page, so they are attacker-controlled by definition; the fields
 * are interpolated into HTML and this email is opened by the operator. That is
 * a deliberate departure from the neighbouring `sendContactFormEmail`, which
 * interpolates its message raw.
 *
 * `replyTo` is the LEAD, so replying in the mail client answers the person
 * rather than the robot. The COACH is in `to`, read from their own
 * `business_settings.reply_to`.
 */
export async function sendNewFunnelLeadEmail(input: NewFunnelLeadEmailInput) {
  const settings = await loadSendableSettings(input.businessId)
  const coachAddress = requireAlertRecipient(settings)

  const displayName = input.name?.trim() || input.email?.trim() || "Someone"

  const answerRows = Object.entries(input.answers)
    .filter(([, value]) => String(value ?? "").trim().length > 0)
    .map(([key, value]) => ({
      label: key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
      value: String(value),
    }))

  const html = tenantEmailLayout(
    `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel("New Lead")}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            ${escapeHtml(displayName)}
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            Signed up through <strong>${escapeHtml(input.pageName)}</strong>.
          </p>

          ${infoCard(
            [
              { label: "Name", value: escapeHtml(input.name ?? "—") },
              { label: "Email", value: escapeHtml(input.email ?? "—") },
              { label: "Phone", value: escapeHtml(input.phone ?? "—") },
            ].concat(answerRows.map((row) => ({ label: escapeHtml(row.label), value: escapeHtml(row.value) }))),
          )}

          <p style="margin:32px 0 0;">
            <a href="${escapeHtml(input.leadsUrl)}" style="display:inline-block; padding:14px 28px; background-color:#0E3F50; color:#ffffff; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; font-weight:600; text-decoration:none; border-radius:2px;">
              Open the leads inbox
            </a>
          </p>

        </td>
      </tr>
    </table>
  `,
    settings,
  )

  // De-duplicated case-insensitively: a funnel whose recipient list already
  // names the coach — in any casing — must not send the same lead twice. The
  // coach's own address is always first, so it is the spelling that survives.
  //
  // `requireAlertRecipient` above is what stops a blank one being dropped
  // here quietly: with a funnel that sets `notify_emails`, a missing coach
  // address still leaves a non-empty list, so the send would succeed and the
  // coach would simply never hear about their own lead.
  const seen = new Set<string>()
  const recipients = [coachAddress, ...(input.extraRecipients ?? [])].filter((address) => {
    const key = address.trim().toLowerCase()
    if (key === "" || seen.has(key)) return false
    seen.add(key)
    return true
  })

  const { error } = await resend.emails.send({
    from: businessFrom(settings),
    to: recipients,
    ...(input.email ? { replyTo: input.email } : {}),
    subject: `[Lead] ${displayName} — ${input.pageName}`,
    html,
  })

  if (error) {
    console.error("Failed to send new funnel lead email:", error)
    throw new Error("Failed to send new funnel lead email")
  }
}
