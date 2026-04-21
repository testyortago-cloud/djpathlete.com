import type {
  SocialPost,
  SocialPlatform,
  SocialApprovalStatus,
  ContentCalendarEntry,
  CalendarEntryType,
  CalendarStatus,
} from "@/types/database"

export interface SocialPostChip {
  kind: "post"
  id: string
  label: string
  /** Date or null (for unscheduled posts). */
  scheduledAt: Date | null
  platformOrType: SocialPlatform
  status: SocialApprovalStatus
  sourceVideoId: string | null
  sourceVideoFilename: string | null
  rejection_notes: string | null
  raw: SocialPost
}

export interface CalendarEntryChip {
  kind: "entry"
  id: string
  label: string
  scheduledAt: Date | null
  platformOrType: CalendarEntryType
  status: CalendarStatus
  raw: ContentCalendarEntry
}

export type CalendarChip = SocialPostChip | CalendarEntryChip

export function postToChip(
  post: SocialPost,
  sourceVideoFilename: string | null = null,
): SocialPostChip {
  // For published posts, use published_at as the chip time; otherwise scheduled_at.
  const ref =
    post.approval_status === "published" && post.published_at
      ? post.published_at
      : post.scheduled_at
  return {
    kind: "post",
    id: post.id,
    label: post.content.slice(0, 30),
    scheduledAt: ref ? new Date(ref) : null,
    platformOrType: post.platform,
    status: post.approval_status,
    sourceVideoId: post.source_video_id,
    sourceVideoFilename,
    rejection_notes: post.rejection_notes,
    raw: post,
  }
}

export function entryToChip(entry: ContentCalendarEntry): CalendarEntryChip {
  const iso = `${entry.scheduled_for}T${entry.scheduled_time ?? "00:00"}:00Z`
  return {
    kind: "entry",
    id: entry.id,
    label: entry.title,
    scheduledAt: new Date(iso),
    platformOrType: entry.entry_type,
    status: entry.status,
    raw: entry,
  }
}

export function isLocked(chip: CalendarChip): boolean {
  if (chip.kind === "post") return chip.status === "published"
  return chip.status === "published"
}

export function isFailed(chip: CalendarChip): boolean {
  if (chip.kind === "post") return chip.status === "failed"
  return false
}

function dayKeyOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function hourKeyOf(date: Date): string {
  const day = dayKeyOf(date)
  const h = String(date.getUTCHours()).padStart(2, "0")
  return `${day}T${h}`
}

export function groupByDay(chips: CalendarChip[]): Record<string, CalendarChip[]> {
  const out: Record<string, CalendarChip[]> = {}
  for (const c of chips) {
    if (!c.scheduledAt) continue
    const key = dayKeyOf(c.scheduledAt)
    ;(out[key] ??= []).push(c)
  }
  return out
}

export function groupByHour(chips: CalendarChip[]): Record<string, CalendarChip[]> {
  const out: Record<string, CalendarChip[]> = {}
  for (const c of chips) {
    if (!c.scheduledAt) continue
    const key = hourKeyOf(c.scheduledAt)
    ;(out[key] ??= []).push(c)
  }
  return out
}

export function dayKey(date: Date): string {
  return dayKeyOf(date)
}
