/**
 * Single source for every messaging limit.
 *
 * The 25 MB number appears in three enforcement points — the browser
 * pre-check, the sign-URL route, and the post-upload verification — and they
 * must never disagree.
 */
import type { AttachmentKind } from "@/types/database"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_BODY_LENGTH = 5000

export const MIME_KINDS: Readonly<Record<string, AttachmentKind>> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
}

export const ALLOWED_MIME_TYPES = Object.keys(MIME_KINDS)

/** How long a message may sit unread before it earns an email. */
export const EMAIL_DELAY_MS = 5 * 60 * 1000

export const MESSAGING_STORAGE_PREFIX = "messaging"

/** Signed upload URLs are short-lived — the browser PUTs immediately. */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000

/**
 * Read URLs are re-signed on every hit through the redirect route, so this only
 * has to outlive a single page view.
 */
export const READ_URL_TTL_MS = 60 * 60 * 1000

/** Cron gate. Default OFF — this cron emails clients. */
export const MESSAGING_EMAIL_CRON_KEY = "cron_messaging_email_enabled"
