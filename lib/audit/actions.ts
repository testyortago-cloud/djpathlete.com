import type { AuditCategory } from "./types"

export interface AuditActionDef {
  slug: string
  category: AuditCategory
  description: string
}

// Closed enum-ish set. Adding a new action means adding a row here.
export const AUDIT_ACTIONS = [
  // auth
  { slug: "auth.login_succeeded",         category: "auth", description: "User signed in successfully" },
  { slug: "auth.login_failed",            category: "auth", description: "Sign-in attempt rejected (bad credentials)" },
  { slug: "auth.logout",                  category: "auth", description: "User signed out" },
  { slug: "auth.register",                category: "auth", description: "New account registered" },
  { slug: "auth.password_reset_request",  category: "auth", description: "Password reset email requested" },
  { slug: "auth.password_reset_complete", category: "auth", description: "Password successfully reset" },
  { slug: "auth.email_verified",          category: "auth", description: "Email address verified" },

  // user / admin_write
  { slug: "user.created",                 category: "admin_write", description: "Admin created a user record" },
  { slug: "user.updated",                 category: "admin_write", description: "Admin updated a user record" },
  { slug: "user.deleted",                 category: "admin_write", description: "Admin deleted a user record" },
  { slug: "user.role_changed",            category: "system",      description: "User role changed" },

  // programs / assignments
  { slug: "program.created",              category: "admin_write", description: "Program created" },
  { slug: "program.updated",              category: "admin_write", description: "Program updated" },
  { slug: "program.deleted",              category: "admin_write", description: "Program deleted" },
  { slug: "program.published",            category: "admin_write", description: "Program status moved to published" },
  { slug: "assignment.created",           category: "admin_write", description: "Program assigned to a client" },
  { slug: "assignment.status_changed",    category: "admin_write", description: "Assignment status changed" },
  { slug: "assignment.updated",           category: "admin_write", description: "Assignment updated (non-status fields)" },
  { slug: "assignment.deleted",           category: "admin_write", description: "Assignment removed" },

  // content
  { slug: "exercise.created",             category: "admin_write", description: "Exercise created" },
  { slug: "exercise.updated",             category: "admin_write", description: "Exercise updated" },
  { slug: "exercise.deleted",             category: "admin_write", description: "Exercise deleted" },
  { slug: "blog_post.created",            category: "admin_write", description: "Blog post created" },
  { slug: "blog_post.updated",            category: "admin_write", description: "Blog post updated" },
  { slug: "blog_post.deleted",            category: "admin_write", description: "Blog post deleted" },
  { slug: "blog_post.published",          category: "admin_write", description: "Blog post published" },

  // integrations / config
  { slug: "integration.connected",        category: "admin_write", description: "Third-party integration connected" },
  { slug: "integration.disconnected",     category: "admin_write", description: "Third-party integration disconnected" },
  { slug: "integration.refreshed",        category: "system",      description: "OAuth token refresh occurred" },
  { slug: "system_setting.changed",       category: "system",      description: "system_settings row updated" },
  { slug: "feature_flag.toggled",         category: "system",      description: "Feature flag toggled" },

  // billing
  { slug: "stripe.checkout_completed",    category: "billing", description: "Stripe Checkout session completed" },
  { slug: "stripe.subscription_created",  category: "billing", description: "Stripe subscription created" },
  { slug: "stripe.subscription_updated",  category: "billing", description: "Stripe subscription updated" },
  { slug: "stripe.subscription_canceled", category: "billing", description: "Stripe subscription canceled" },
  { slug: "stripe.payment_succeeded",     category: "billing", description: "Stripe payment succeeded" },
  { slug: "stripe.payment_failed",        category: "billing", description: "Stripe payment failed" },
  { slug: "stripe.refund",                category: "billing", description: "Stripe refund issued" },

  // automation
  { slug: "cron.manual_trigger",          category: "automation", description: "Cron was manually triggered from admin UI" },
  { slug: "agent.run",                    category: "automation", description: "Strategy team agent completed a run" },
  { slug: "ai.generation_started",        category: "automation", description: "AI program generation started" },
  { slug: "ai.generation_completed",      category: "automation", description: "AI program generation completed" },
  { slug: "ai.feedback_submitted",        category: "automation", description: "User submitted AI feedback (rating/correction)" },

  // client_action — workout / training side
  { slug: "workout.completed",            category: "client_action", description: "Client marked a training session complete (boundary event; per-set data in training_sessions)" },
  { slug: "workout.session_started",      category: "client_action", description: "Client started a training session" },
  { slug: "workout.skipped",              category: "client_action", description: "Client marked a session as skipped" },
  { slug: "pr.claimed",                   category: "client_action", description: "Personal record reached / claimed" },

  // client_action — assessments + readiness + goals + injuries + performance
  { slug: "assessment.submitted",         category: "client_action", description: "Initial assessment submitted" },
  { slug: "assessment.reassessment_submitted", category: "client_action", description: "Reassessment submitted" },
  { slug: "questionnaire.submitted",      category: "client_action", description: "Onboarding questionnaire submitted" },
  { slug: "readiness.submitted",          category: "client_action", description: "Daily readiness check-in submitted" },
  { slug: "goal.created",                 category: "client_action", description: "Athlete goal created" },
  { slug: "goal.updated",                 category: "client_action", description: "Athlete goal updated" },
  { slug: "goal.deleted",                 category: "client_action", description: "Athlete goal deleted" },
  { slug: "injury.reported",              category: "client_action", description: "Injury reported" },
  { slug: "injury.updated",               category: "client_action", description: "Injury updated (status, notes)" },
  { slug: "injury.resolved",              category: "client_action", description: "Injury marked resolved" },
  { slug: "performance_test.submitted",   category: "client_action", description: "Performance test result submitted" },
  { slug: "performance_test.deleted",     category: "client_action", description: "Performance test entry deleted" },

  // client_action — profile + preferences + self-service billing
  { slug: "profile.updated",              category: "client_action", description: "Client updated their own profile" },
  { slug: "notification_preferences.changed", category: "client_action", description: "Notification preferences changed" },
  { slug: "subscription.cancel_requested", category: "client_action", description: "Client requested self-service cancel" },

  // support — coach<>client flows
  { slug: "form_review.submitted",        category: "support", description: "Client submitted a video for form review" },
  { slug: "form_review.reviewed",         category: "support", description: "Coach left feedback on a form review" },
  { slug: "form_review.deleted",          category: "support", description: "Form review removed" },
  { slug: "team_video.submitted",         category: "support", description: "Team video submission uploaded" },
  { slug: "team_video.annotated",         category: "support", description: "Annotation added to team video" },
  { slug: "team_video.commented",         category: "support", description: "Comment added to team video" },
  { slug: "team_video.version_added",     category: "support", description: "New version uploaded to team video submission" },
  { slug: "inbox.message_sent",           category: "support", description: "Coach sent a message via GHL inbox bridge" },

  // commerce — bookings + shop
  { slug: "booking.created",              category: "commerce", description: "Booking created" },
  { slug: "booking.rescheduled",          category: "commerce", description: "Booking rescheduled" },
  { slug: "booking.cancelled",            category: "commerce", description: "Booking cancelled" },
  { slug: "booking.completed",            category: "commerce", description: "Booking marked completed" },
  { slug: "booking.no_show",              category: "commerce", description: "Booking marked no-show" },
  { slug: "shop.order_created",           category: "commerce", description: "Shop order created" },
  { slug: "shop.order_paid",              category: "commerce", description: "Shop order marked paid (Stripe webhook bridge)" },
  { slug: "shop.order_fulfilled",         category: "commerce", description: "Shop order fulfilled" },
  { slug: "shop.order_refunded",          category: "commerce", description: "Shop order refunded" },
  { slug: "shop.download_issued",         category: "commerce", description: "Digital download link issued" },
  { slug: "shop.lead_captured",           category: "commerce", description: "Shop lead captured (pre-purchase)" },
  { slug: "shop.product_created",         category: "admin_write", description: "Shop product created (admin)" },
  { slug: "shop.product_updated",         category: "admin_write", description: "Shop product updated (admin)" },
  { slug: "shop.product_deleted",         category: "admin_write", description: "Shop product deleted (admin)" },

  // marketing — public / outbound
  { slug: "newsletter.subscribed",        category: "marketing", description: "Newsletter subscription created" },
  { slug: "newsletter.unsubscribed",      category: "marketing", description: "Newsletter unsubscribe processed" },
  { slug: "newsletter.sent",              category: "marketing", description: "Newsletter campaign sent" },
  { slug: "lead_magnet.downloaded",       category: "marketing", description: "Lead magnet downloaded" },
  { slug: "event_signup.created",         category: "marketing", description: "Public event signup" },
  { slug: "event_signup.cancelled",       category: "marketing", description: "Event signup cancelled" },
  { slug: "contact.submitted",            category: "marketing", description: "Public contact form submitted" },
  { slug: "review.submitted",             category: "marketing", description: "Public review submitted" },
  { slug: "review.moderated",             category: "marketing", description: "Admin moderated a review (approve/reject)" },
  { slug: "testimonial.submitted",        category: "marketing", description: "Testimonial submitted" },
  { slug: "testimonial.moderated",        category: "marketing", description: "Admin moderated a testimonial" },

  // compliance — consents + GDPR + legal
  { slug: "consent.granted",              category: "compliance", description: "User accepted a legal consent (terms / privacy / waiver / parental)" },
  { slug: "consent.withdrawn",            category: "compliance", description: "User withdrew a consent" },
  { slug: "marketing_consent.changed",    category: "compliance", description: "Marketing consent preference changed" },
  { slug: "legal_document.published",     category: "compliance", description: "New version of a legal document published" },
  { slug: "data.export",                  category: "compliance", description: "Data export performed" },
  { slug: "data.deleted_bulk",            category: "compliance", description: "Bulk delete operation" },
  { slug: "gdpr.export_requested",        category: "compliance", description: "GDPR export requested" },
  { slug: "gdpr.delete_requested",        category: "compliance", description: "GDPR delete requested" },
] as const satisfies readonly AuditActionDef[]

export type AuditAction = (typeof AUDIT_ACTIONS)[number]["slug"]

const SLUG_INDEX: Map<string, AuditActionDef> = new Map(
  AUDIT_ACTIONS.map((a) => [a.slug, a])
)
export function getActionDef(slug: string): AuditActionDef | undefined {
  return SLUG_INDEX.get(slug)
}
