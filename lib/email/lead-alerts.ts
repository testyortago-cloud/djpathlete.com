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
import { escapeHtml, infoCard, resend, sectionLabel, tenantEmailLayout } from "@/lib/email/layout"

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
