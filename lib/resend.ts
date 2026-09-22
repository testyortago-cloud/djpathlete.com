import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY!)
// `mail.darrenjpaul.com` is the ONLY domain in the Resend account -- verified,
// us-east-1, added 2026-09-20. The apex `darrenjpaul.com` has never been in it,
// and `send.darrenjpaul.com` is no longer in it either: sending from either
// returns "domain is not verified" and drops the message. The fallback
// therefore has to name the live subdomain -- an unset RESEND_FROM_EMAIL must
// not be able to reintroduce the 2026-08-31 fault that killed 73 sequence runs.
//
// CHANGED 2026-09-23: this fallback said `send.darrenjpaul.com` until the
// account moved. Measured, not assumed -- the Resend domain list has one row,
// and the last 100 real sends are all from `noreply@mail.darrenjpaul.com`.
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@mail.darrenjpaul.com>"
