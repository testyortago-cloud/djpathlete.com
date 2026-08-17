import type { AuditCategory } from "./types"

export interface AuditActionDef {
  slug: string
  category: AuditCategory
  description: string
}

// Closed enum-ish set. Adding a new action means adding a row here.
export const AUDIT_ACTIONS = [
  // auth
  { slug: "auth.login_succeeded", category: "auth", description: "User signed in successfully" },
  { slug: "auth.login_failed", category: "auth", description: "Sign-in attempt rejected (bad credentials)" },
  { slug: "auth.logout", category: "auth", description: "User signed out" },
  { slug: "auth.register", category: "auth", description: "New account registered" },
  { slug: "auth.password_reset_request", category: "auth", description: "Password reset email requested" },
  { slug: "auth.password_reset_complete", category: "auth", description: "Password successfully reset" },
  { slug: "auth.email_verified", category: "auth", description: "Email address verified" },

  // user / admin_write
  { slug: "user.created", category: "admin_write", description: "Admin created a user record" },
  { slug: "user.updated", category: "admin_write", description: "Admin updated a user record" },
  { slug: "user.deleted", category: "admin_write", description: "Admin deleted a user record" },
  { slug: "user.role_changed", category: "system", description: "User role changed" },

  // programs / assignments
  { slug: "program.created", category: "admin_write", description: "Program created" },
  { slug: "program.imported", category: "admin_write", description: "Program imported from Excel" },
  { slug: "program.updated", category: "admin_write", description: "Program updated" },
  { slug: "program.deleted", category: "admin_write", description: "Program deleted" },
  { slug: "program.published", category: "admin_write", description: "Program status moved to published" },
  { slug: "assignment.created", category: "admin_write", description: "Program assigned to a client" },
  { slug: "assignment.status_changed", category: "admin_write", description: "Assignment status changed" },
  { slug: "assignment.updated", category: "admin_write", description: "Assignment updated (non-status fields)" },
  { slug: "assignment.deleted", category: "admin_write", description: "Assignment removed" },

  // content
  { slug: "exercise.created", category: "admin_write", description: "Exercise created" },
  { slug: "exercise.updated", category: "admin_write", description: "Exercise updated" },
  { slug: "exercise.deleted", category: "admin_write", description: "Exercise deleted" },
  { slug: "blog_post.created", category: "admin_write", description: "Blog post created" },
  { slug: "blog_post.updated", category: "admin_write", description: "Blog post updated" },
  { slug: "blog_post.deleted", category: "admin_write", description: "Blog post deleted" },
  { slug: "blog_post.published", category: "admin_write", description: "Blog post published" },

  // integrations / config
  { slug: "integration.connected", category: "admin_write", description: "Third-party integration connected" },
  { slug: "integration.disconnected", category: "admin_write", description: "Third-party integration disconnected" },
  { slug: "integration.refreshed", category: "system", description: "OAuth token refresh occurred" },
  { slug: "system_setting.changed", category: "system", description: "system_settings row updated" },
  { slug: "feature_flag.toggled", category: "system", description: "Feature flag toggled" },

  // google ads — direct admin actions on remote campaigns
  {
    slug: "ads.campaign_status_changed",
    category: "admin_write",
    description: "Google Ads campaign paused or resumed from admin UI",
  },
  {
    slug: "ads.campaign_budget_changed",
    category: "admin_write",
    description: "Google Ads campaign daily budget changed from admin UI",
  },
  { slug: "ads.campaign_renamed", category: "admin_write", description: "Google Ads campaign renamed from admin UI" },
  {
    slug: "ads.ad_group_status_changed",
    category: "admin_write",
    description: "Google Ads ad group paused or resumed from admin UI",
  },
  {
    slug: "ads.ad_status_changed",
    category: "admin_write",
    description: "Google Ads ad paused or resumed from admin UI",
  },

  // billing
  { slug: "stripe.checkout_completed", category: "billing", description: "Stripe Checkout session completed" },
  { slug: "stripe.subscription_created", category: "billing", description: "Stripe subscription created" },
  { slug: "stripe.subscription_updated", category: "billing", description: "Stripe subscription updated" },
  { slug: "stripe.subscription_canceled", category: "billing", description: "Stripe subscription canceled" },
  { slug: "stripe.payment_succeeded", category: "billing", description: "Stripe payment succeeded" },
  { slug: "stripe.payment_failed", category: "billing", description: "Stripe payment failed" },
  { slug: "stripe.refund", category: "billing", description: "Stripe refund issued" },

  // automation
  { slug: "cron.manual_trigger", category: "automation", description: "Cron was manually triggered from admin UI" },
  { slug: "agent.run", category: "automation", description: "Strategy team agent completed a run" },
  { slug: "ai.generation_started", category: "automation", description: "AI program generation started" },
  { slug: "ai.generation_completed", category: "automation", description: "AI program generation completed" },
  {
    slug: "lead.ai_analysis_generated",
    category: "automation",
    description: "AI priority/summary/draft-reply generated for a lead inquiry",
  },
  {
    slug: "ai.feedback_submitted",
    category: "automation",
    description: "User submitted AI feedback (rating/correction)",
  },

  // client_action — workout / training side
  {
    slug: "workout.completed",
    category: "client_action",
    description: "Client marked a training session complete (boundary event; per-set data in training_sessions)",
  },
  { slug: "workout.session_started", category: "client_action", description: "Client started a training session" },
  { slug: "workout.skipped", category: "client_action", description: "Client marked a session as skipped" },
  { slug: "pr.claimed", category: "client_action", description: "Personal record reached / claimed" },

  // client_action — assessments + readiness + goals + injuries + performance
  { slug: "assessment.submitted", category: "client_action", description: "Initial assessment submitted" },
  { slug: "assessment.reassessment_submitted", category: "client_action", description: "Reassessment submitted" },
  { slug: "questionnaire.submitted", category: "client_action", description: "Onboarding questionnaire submitted" },
  { slug: "readiness.submitted", category: "client_action", description: "Daily readiness check-in submitted" },
  { slug: "goal.created", category: "client_action", description: "Athlete goal created" },
  { slug: "goal.updated", category: "client_action", description: "Athlete goal updated" },
  { slug: "goal.deleted", category: "client_action", description: "Athlete goal deleted" },
  { slug: "injury.reported", category: "client_action", description: "Injury reported" },
  { slug: "injury.updated", category: "client_action", description: "Injury updated (status, notes)" },
  { slug: "injury.resolved", category: "client_action", description: "Injury marked resolved" },
  { slug: "performance_test.submitted", category: "client_action", description: "Performance test result submitted" },
  { slug: "performance_test.deleted", category: "client_action", description: "Performance test entry deleted" },

  // client_action — profile + preferences + self-service billing
  { slug: "profile.updated", category: "client_action", description: "Client updated their own profile" },
  { slug: "exercise_favorite.added", category: "client_action", description: "Exercise favorited" },
  { slug: "exercise_favorite.removed", category: "client_action", description: "Exercise unfavorited" },
  {
    slug: "notification_preferences.changed",
    category: "client_action",
    description: "Notification preferences changed",
  },
  {
    slug: "subscription.cancel_requested",
    category: "client_action",
    description: "Client requested self-service cancel",
  },

  // support — coach<>client flows
  { slug: "form_review.submitted", category: "support", description: "Client submitted a video for form review" },
  { slug: "form_review.reviewed", category: "support", description: "Coach left feedback on a form review" },
  { slug: "form_review.deleted", category: "support", description: "Form review removed" },
  {
    slug: "form_review.message.audio_sent",
    category: "client_action",
    description: "Voice message sent on a form review thread",
  },
  { slug: "team_video.submitted", category: "support", description: "Team video submission uploaded" },
  { slug: "team_video.annotated", category: "support", description: "Annotation added to team video" },
  { slug: "team_video.commented", category: "support", description: "Comment added to team video" },
  {
    slug: "team_video.version_added",
    category: "support",
    description: "New version uploaded to team video submission",
  },
  { slug: "inbox.message_sent", category: "support", description: "Coach sent a message via GHL inbox bridge" },

  // commerce — bookings + shop
  { slug: "booking.created", category: "commerce", description: "Booking created" },
  { slug: "booking.rescheduled", category: "commerce", description: "Booking rescheduled" },
  { slug: "booking.cancelled", category: "commerce", description: "Booking cancelled" },
  { slug: "booking.completed", category: "commerce", description: "Booking marked completed" },
  { slug: "booking.no_show", category: "commerce", description: "Booking marked no-show" },
  { slug: "shop.order_created", category: "commerce", description: "Shop order created" },
  { slug: "shop.order_paid", category: "commerce", description: "Shop order marked paid (Stripe webhook bridge)" },
  { slug: "shop.order_fulfilled", category: "commerce", description: "Shop order fulfilled" },
  { slug: "shop.order_refunded", category: "commerce", description: "Shop order refunded" },
  { slug: "shop.download_issued", category: "commerce", description: "Digital download link issued" },
  { slug: "shop.lead_captured", category: "commerce", description: "Shop lead captured (pre-purchase)" },
  { slug: "shop.product_created", category: "admin_write", description: "Shop product created (admin)" },
  { slug: "shop.product_updated", category: "admin_write", description: "Shop product updated (admin)" },
  { slug: "shop.product_deleted", category: "admin_write", description: "Shop product deleted (admin)" },

  // marketing — public / outbound
  { slug: "newsletter.subscribed", category: "marketing", description: "Newsletter subscription created" },
  { slug: "newsletter.unsubscribed", category: "marketing", description: "Newsletter unsubscribe processed" },
  { slug: "newsletter.sent", category: "marketing", description: "Newsletter campaign sent" },
  { slug: "lead_magnet.downloaded", category: "marketing", description: "Lead magnet downloaded" },
  { slug: "event_signup.created", category: "marketing", description: "Public event signup" },
  { slug: "event_signup.cancelled", category: "marketing", description: "Event signup cancelled" },
  { slug: "contact.submitted", category: "marketing", description: "Public contact form submitted" },
  { slug: "funnel.submission_received", category: "marketing", description: "Funnel page form submitted" },
  { slug: "funnel.created", category: "admin_write", description: "Funnel created (admin)" },
  { slug: "funnel.updated", category: "admin_write", description: "Funnel or step updated (admin)" },
  { slug: "funnel.published", category: "admin_write", description: "Funnel step or whole funnel published (admin)" },
  { slug: "funnel.deleted", category: "admin_write", description: "Funnel or step deleted (admin)" },
  { slug: "funnel.ai_turn", category: "admin_write", description: "Funnel page AI build turn (admin)" },
  {
    // The one automation in the app that changes what a visitor sees. Audited
    // because "who took my camp page down" must have an answer.
    slug: "funnel.auto_offline",
    category: "automation",
    description: "Funnel taken offline because its run window closed (cron)",
  },
  {
    slug: "funnel.reverted",
    category: "admin_write",
    description: "Funnel page draft reverted to an earlier turn (admin)",
  },
  {
    slug: "funnel.version_restored",
    category: "admin_write",
    description: "Funnel step pointed back at an earlier published version (admin)",
  },
  {
    slug: "funnel.lead_status_changed",
    category: "admin_write",
    description: "Funnel lead moved between new/contacted/signed up (admin)",
  },
  { slug: "funnel.lead_note_written", category: "admin_write", description: "Note written on a funnel lead (admin)" },
  {
    slug: "funnel.leads_exported",
    category: "admin_read_sensitive",
    description: "Funnel leads exported to CSV (admin)",
  },
  { slug: "review.submitted", category: "marketing", description: "Public review submitted" },
  { slug: "review.moderated", category: "marketing", description: "Admin moderated a review (approve/reject)" },
  { slug: "testimonial.submitted", category: "marketing", description: "Testimonial submitted" },
  { slug: "testimonial.moderated", category: "marketing", description: "Admin moderated a testimonial" },
  { slug: "faq.create", category: "marketing", description: "FAQ entry created" },
  { slug: "faq.update", category: "marketing", description: "FAQ entry updated" },
  { slug: "faq.delete", category: "marketing", description: "FAQ entry deleted" },
  { slug: "faq.reorder", category: "marketing", description: "FAQ entries reordered" },
  { slug: "about_page.update", category: "marketing", description: "About page content updated" },
  { slug: "athletes_page.update", category: "marketing", description: "Athletes page content updated" },
  { slug: "step_up_page.update", category: "marketing", description: "Step Up For Students page content updated" },

  // compliance — consents + GDPR + legal
  {
    slug: "consent.granted",
    category: "compliance",
    description: "User accepted a legal consent (terms / privacy / waiver / parental)",
  },
  { slug: "consent.withdrawn", category: "compliance", description: "User withdrew a consent" },
  { slug: "marketing_consent.changed", category: "compliance", description: "Marketing consent preference changed" },
  {
    slug: "legal_document.published",
    category: "compliance",
    description: "New version of a legal document published",
  },
  { slug: "data.export", category: "compliance", description: "Data export performed" },
  { slug: "data.deleted_bulk", category: "compliance", description: "Bulk delete operation" },
  { slug: "gdpr.export_requested", category: "compliance", description: "GDPR export requested" },
  { slug: "gdpr.delete_requested", category: "compliance", description: "GDPR delete requested" },
  { slug: "split_reel.broll_generate", category: "admin_write", description: "Split Reel b-roll generation started" },
  { slug: "split_reel.render", category: "admin_write", description: "Split Reel render started" },
  { slug: "split_reel.regenerate", category: "admin_write", description: "Split Reel b-roll window regenerated" },
  { slug: "reel_editor.save", category: "admin_write", description: "Reel editor snapshot saved" },

  // session packs (in-person credit tracking)
  { slug: "pack.sold", category: "commerce", description: "Session pack sold to a client" },
  { slug: "pack.checkin", category: "client_action", description: "Client checked in; credit deducted" },
  { slug: "pack.checkin_voided", category: "client_action", description: "Check-in voided; credit restored" },
  { slug: "pack.refunded", category: "commerce", description: "Session pack refunded" },
  { slug: "pack.expired", category: "system", description: "Session pack expired" },
  { slug: "pack.deleted", category: "commerce", description: "Session pack deleted by admin" },
  {
    slug: "pack.payment_link_refreshed",
    category: "commerce",
    description: "Session pack payment link retrieved/regenerated",
  },
  {
    slug: "pack.payment_link_emailed",
    category: "commerce",
    description: "Session pack payment link emailed to the payer",
  },
  {
    slug: "pack.bill_to_changed",
    category: "commerce",
    description: "Session pack billing email changed (payment link re-issued)",
  },
  {
    slug: "pack.marked_paid",
    category: "commerce",
    description: "Session pack manually marked paid (offline payment received)",
  },
  { slug: "pack.auto_renewed", category: "commerce", description: "Pack auto-renewed against a saved card" },
  { slug: "pack.auto_renew_failed", category: "commerce", description: "Pack auto-renewal charge failed" },
  { slug: "pack.auto_renew_enabled", category: "commerce", description: "Auto-renew turned on for a pack" },
  { slug: "pack.auto_renew_disabled", category: "commerce", description: "Auto-renew turned off for a pack" },
  { slug: "session.slot_created", category: "admin_write", description: "Recurring session slot created" },
  { slug: "session.slot_updated", category: "admin_write", description: "Recurring session slot updated" },
  { slug: "session.attended", category: "client_action", description: "Scheduled session marked attended" },
  { slug: "session.no_show", category: "client_action", description: "Scheduled session marked no-show" },
  { slug: "session.cancelled", category: "client_action", description: "Scheduled session cancelled" },
  { slug: "session.rescheduled", category: "admin_write", description: "Scheduled session rescheduled/reassigned" },
  { slug: "session.fee_charged", category: "commerce", description: "No-show / late-cancel fee charged" },
  { slug: "session.fee_failed", category: "commerce", description: "No-show / late-cancel fee charge failed" },
  { slug: "membership.subscribed", category: "commerce", description: "Client subscribed to a session membership" },
  { slug: "membership.canceled", category: "commerce", description: "Session membership canceled" },
  { slug: "card.saved", category: "commerce", description: "Client card saved on file" },
  { slug: "client.billing_payer_set", category: "admin_write", description: "Client billing payer set or cleared" },

  // bookkeeping
  { slug: "bookkeeping.entry_created", category: "commerce", description: "Ledger entry created" },
  { slug: "bookkeeping.entry_updated", category: "commerce", description: "Ledger entry updated" },
  { slug: "bookkeeping.entry_deleted", category: "commerce", description: "Ledger entry deleted" },
  { slug: "bookkeeping.account_created", category: "commerce", description: "Chart-of-accounts category created" },
  { slug: "bookkeeping.account_updated", category: "commerce", description: "Chart-of-accounts category updated" },
  {
    slug: "bookkeeping.platform_income_imported",
    category: "commerce",
    description: "Platform income posted to the ledger",
  },
  { slug: "bookkeeping.statement_uploaded", category: "commerce", description: "Bank/Venmo statement uploaded" },
  {
    slug: "bookkeeping.statement_imported",
    category: "commerce",
    description: "Bank/Venmo statement posted to the ledger",
  },
  { slug: "bookkeeping.document_deleted", category: "commerce", description: "Bookkeeping document deleted" },
  {
    slug: "bookkeeping.document_downloaded",
    category: "admin_read_sensitive",
    description: "Bookkeeping document downloaded",
  },
  {
    slug: "bookkeeping.receipt_cash_recorded",
    category: "commerce",
    description: "Cash receipt recorded to the ledger",
  },
  { slug: "bookkeeping.receipt_uploaded", category: "commerce", description: "Receipt image / Amazon CSV uploaded" },
  { slug: "bookkeeping.receipt_imported", category: "commerce", description: "Receipt posted to the ledger" },
  {
    slug: "bookkeeping.receipt_ignored",
    category: "commerce",
    description: "Email receipt dismissed from review without posting",
  },
  { slug: "bookkeeping.report_exported", category: "admin_read_sensitive", description: "Bookkeeping report exported" },
  { slug: "bookkeeping.report_emailed", category: "commerce", description: "Accountant pack emailed" },
  {
    slug: "bookkeeping.home_office_percent_set",
    category: "commerce",
    description: "Home-office share percentage set for the deduction proposal",
  },
  {
    slug: "bookkeeping.tax_rate_percent_set",
    category: "commerce",
    description: "Flat effective tax rate set for the rolling forecast",
  },
  {
    slug: "bookkeeping.period_closed",
    category: "commerce",
    description: "Bookkeeping month closed — totals snapshot frozen",
  },
  {
    slug: "bookkeeping.period_reopened",
    category: "commerce",
    description: "Closed bookkeeping month reopened (snapshot preserved in this audit row)",
  },
  { slug: "bookkeeping.close_emailed", category: "commerce", description: "Books-closed statement emailed" },
  {
    slug: "bookkeeping.receipt_watchdog_emailed",
    category: "commerce",
    description: "Weekly missing-receipt watchdog email sent to the coach",
  },
  {
    slug: "bookkeeping.close_nudge_emailed",
    category: "commerce",
    description: "Monthly close nudge emailed — finished months still open",
  },
  { slug: "bookkeeping.asset_created", category: "commerce", description: "Depreciable asset added to the register" },
  { slug: "bookkeeping.asset_updated", category: "commerce", description: "Depreciable asset updated" },
  {
    slug: "bookkeeping.asset_deleted",
    category: "commerce",
    description: "Depreciable asset deleted from the register",
  },
  {
    slug: "bookkeeping.income_synced",
    category: "commerce",
    description: "Nightly cron posted new platform income to the ledger",
  },
  {
    slug: "bookkeeping.gmail_receipt_ingested",
    category: "commerce",
    description: "Hourly Gmail poller ingested labeled receipt attachments",
  },
  {
    slug: "bookkeeping.finding_dismissed",
    category: "commerce",
    description: "Insight finding dismissed from the insights page",
  },
  {
    slug: "bookkeeping.finding_undismissed",
    category: "commerce",
    description: "Insight finding dismissal removed — finding restored",
  },
  {
    slug: "bookkeeping.payout_synced",
    category: "commerce",
    description: "Nightly cron ingested Stripe payouts into the payout mirror",
  },
  {
    slug: "bookkeeping.setup_manual_check_set",
    category: "admin_write",
    description: "Setup-checklist manual item checked or unchecked",
  },
  { slug: "bookkeeping.tour_completed", category: "admin_write", description: "Books cross-page tour completed" },
  // Individual messages are deliberately NOT audited -- the messages table IS
  // the record, and per-message rows would swamp the trail (same rule already
  // applied to per-set workout logs and page visits). Only opening a
  // conversation is an admin action worth a row.
  {
    slug: "messaging.conversation_created",
    category: "admin_write",
    description: "Coach opened a message thread with a client",
  },

  // team / permissions -- who could see what, and when it changed
  { slug: "team.invite_sent", category: "admin_write", description: "Team invite created and emailed" },
  { slug: "team.invite_resent", category: "admin_write", description: "Team invite token rotated and re-emailed" },
  { slug: "team.invite_revoked", category: "admin_write", description: "Team invite expired early" },
  {
    slug: "team.member_permissions_changed",
    category: "admin_write",
    description: "Staff member's permission map edited (records before and after)",
  },
  { slug: "team.member_suspended", category: "admin_write", description: "Staff member suspended or reactivated" },
  { slug: "team.member_removed", category: "admin_write", description: "Staff member removed" },
  {
    slug: "team.client_assignments_changed",
    category: "admin_write",
    description: "Which clients a staff member can see was changed",
  },
  {
    slug: "permission.denied",
    category: "compliance",
    description: "A staff member was refused a surface they lack permission for",
  },
] as const satisfies readonly AuditActionDef[]

export type AuditAction = (typeof AUDIT_ACTIONS)[number]["slug"]

const SLUG_INDEX: Map<string, AuditActionDef> = new Map(AUDIT_ACTIONS.map((a) => [a.slug, a]))
export function getActionDef(slug: string): AuditActionDef | undefined {
  return SLUG_INDEX.get(slug)
}
