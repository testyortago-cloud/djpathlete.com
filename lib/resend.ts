import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY!)
// Resend verifies `send.darrenjpaul.com` only — the apex `darrenjpaul.com` has
// never been added to the account, and sending from it returns "domain is not
// verified" and drops the message. The fallback therefore has to name the
// subdomain: an unset RESEND_FROM_EMAIL must not be able to reintroduce the
// 2026-08-31 fault that killed 73 sequence runs.
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@send.darrenjpaul.com>"
