import type { AttachmentKind } from "@/types/database"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MESSAGING_STORAGE_PREFIX,
  MIME_KINDS,
} from "./config"

export interface AttachmentSpec {
  mime_type: string
  byte_size: number
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Map a mime type onto a render kind.
 *
 * Returns null — never a default — for anything unrecognized. This decides what
 * may be STORED, and a permissive fallback here would let a .txt be filed as an
 * image that renders as nothing.
 */
export function kindForMime(mime: string): AttachmentKind | null {
  return MIME_KINDS[mime] ?? null
}

export function validateAttachmentSpecs(specs: AttachmentSpec[]): ValidationResult {
  if (specs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.` }
  }
  for (const spec of specs) {
    if (!kindForMime(spec.mime_type)) {
      return {
        ok: false,
        error: `${spec.mime_type || "That file type"} is not supported. Send an image or a video.`,
      }
    }
    if (!Number.isFinite(spec.byte_size) || spec.byte_size <= 0) {
      return { ok: false, error: "That file looks empty." }
    }
    if (spec.byte_size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "Files must be 25 MB or smaller." }
    }
  }
  return { ok: true }
}

/** messaging/<conversationId>/<uploadId>/<safeFilename> */
export function buildStoragePath(conversationId: string, uploadId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  return `${MESSAGING_STORAGE_PREFIX}/${conversationId}/${uploadId}/${safe}`
}
