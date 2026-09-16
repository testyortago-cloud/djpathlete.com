/**
 * Which unpaid renewal packs are due another payment link.
 *
 * Pure on purpose — it takes no Stripe call and no clock of its own, so the
 * stopping rule is testable without either. "Is the link actually dead" is NOT
 * decided here: that is Stripe's answer, and resolvePackPaymentLink already
 * encodes the only safe reading of it (re-mint on a verified `expired`, never
 * on `complete`, never on a transient error). This function answers the
 * narrower question the cron owns — may we contact this payer again at all.
 */

/**
 * How long after a re-send the pack is held back.
 *
 * A Stripe Checkout session lives 24 hours and the cron runs daily, so a link
 * minted at 09:00 expires at 09:00 the next day — the same minute the next run
 * asks Stripe whether it is dead. Without a throttle that is a coin flip; with
 * one shorter than 24h the run still reaches Stripe and simply finds the link
 * alive, which is the correct answer, not a missed send.
 */
export const PACK_LINK_RESEND_THROTTLE_MS = 20 * 60 * 60 * 1000

export interface LinkResendCandidate {
  id: string
  /** Null when the migration has not reached this deploy yet — see the test. */
  payment_link_resent_count?: number | null
  payment_link_resent_at?: string | null
}

export function selectPacksDueLinkResend<T extends LinkResendCandidate>(
  packs: T[],
  now: Date,
  opts: { maxResends: number; throttleMs: number },
): T[] {
  return packs.filter((pack) => {
    // A missing column reads as zero, never as "budget spent". Failing closed
    // here would make the feature inert in exactly the window it is needed;
    // the stamping write is where an old schema is allowed to stop us, because
    // there a failure happens BEFORE the email rather than after it.
    const sent = pack.payment_link_resent_count ?? 0
    if (sent >= opts.maxResends) return false

    if (pack.payment_link_resent_at) {
      const last = Date.parse(pack.payment_link_resent_at)
      // An unparseable stamp must not pin a pack shut forever. Let it through;
      // the budget above is the real guard against runaway emailing.
      if (!Number.isNaN(last) && now.getTime() - last < opts.throttleMs) return false
    }

    return true
  })
}
