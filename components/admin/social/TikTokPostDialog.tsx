"use client"

// The "Post to TikTok" screen. TikTok's content-sharing guidelines decide its
// shape: fresh creator info on every open, the account shown, privacy chosen
// from the account's own options with no default, interactions and disclosure
// off until the coach turns them on, the declaration above the button, and a
// preview of the exact file. What the coach picks here is what gets sent.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Loader2, Send, UserRound } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { readApiError } from "@/lib/errors/humanize"
import {
  PRIVACY_LABELS,
  disclosureLabel,
  emptyDraft,
  lengthBlocker,
  prefillDraft,
  submitBlocker,
  toSettings,
  type TikTokCreatorInfo,
  type TikTokDraft,
} from "@/lib/social/tiktok-post-rules"
import type { TikTokPostSettings } from "@/lib/validators/tiktok-post-settings"
import { cn } from "@/lib/utils"
import type { SocialPost } from "@/types/database"

const CAPTION_MAX = 2200
const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
const BC_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en"
const SUCCESS = "Sent to TikTok. It can take a few minutes to appear on your profile."
const DRAFT_SUCCESS = "Sent to your TikTok drafts. Open TikTok and check your inbox to finish and post it."
const JSON_HEADERS = { "content-type": "application/json" }

interface TikTokPostDialogProps {
  post: SocialPost
  intent: "now" | "schedule"
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "now": called with the publish-now result merged into the post. */
  onQueued: (updated: SocialPost) => void
  /** "schedule": settings saved; caller opens SchedulePickerDialog. */
  onReadyToSchedule: (updated: SocialPost) => void
}

type Load =
  | { state: "loading" }
  | { state: "refused"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; creator: TikTokCreatorInfo; previewUrl: string }

export function TikTokPostDialog({
  post,
  intent,
  open,
  onOpenChange,
  onQueued,
  onReadyToSchedule,
}: TikTokPostDialogProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState<TikTokDraft>(emptyDraft)
  const [caption, setCaption] = useState(post.content)
  const [duration, setDuration] = useState<number | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  // The caption the server holds. A PATCH can land while a later request fails
  // and the parent never hears of it, so this outranks a stale post.content
  // until the parent sends a newer one.
  const savedCaption = useRef(post.content)
  useEffect(() => {
    savedCaption.current = post.content
  }, [post.content])

  // Before paint, so a reopen never flashes the previous open's form.
  useLayoutEffect(() => {
    if (open) setLoad({ state: "loading" })
  }, [open, post.id, attempt])

  // TikTok requires creator info fetched fresh each time the screen opens.
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`/api/admin/social/posts/${post.id}/tiktok`)
      .then(async (res) => {
        if (!res.ok) {
          const message = await readApiError(res, "Couldn't open TikTok. Try again.")
          if (live) setLoad(res.status === 409 ? { state: "refused", message } : { state: "error", message })
          return
        }
        const data = (await res.json()) as {
          creator: TikTokCreatorInfo
          previewUrl: string
          saved: TikTokPostSettings | null
        }
        if (!live) return
        setDraft(prefillDraft(data.saved, data.creator))
        setCaption(savedCaption.current)
        setDuration(null)
        setVideoFailed(false)
        setLoad({ state: "ready", creator: data.creator, previewUrl: data.previewUrl })
      })
      .catch(() => {
        if (live) setLoad({ state: "error", message: "We couldn't reach the server. Please try again." })
      })
    return () => {
      live = false
    }
  }, [open, post.id, post.content, attempt])

  const creator = load.state === "ready" ? load.creator : null
  const blocker = !creator
    ? null
    : videoFailed
      ? "Couldn't load this video."
      : (submitBlocker(draft, creator, duration) ??
        (caption.trim() === ""
          ? "Write a caption."
          : caption.length > CAPTION_MAX
            ? `Shorten the caption to ${CAPTION_MAX} characters or fewer.`
            : null))

  function set<K extends keyof TikTokDraft>(key: K, value: TikTokDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function confirm() {
    if (busy || blocker !== null) return
    setBusy(true)
    try {
      let updated: SocialPost = { ...post, content: savedCaption.current }
      if (caption.trim() !== savedCaption.current.trim()) {
        const res = await fetch(`/api/admin/social/posts/${post.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ caption_text: caption }),
        })
        if (!res.ok) throw new Error(await readApiError(res, "Couldn't save the caption."))
        const data = (await res.json()) as Pick<SocialPost, "content" | "approval_status">
        savedCaption.current = data.content
        updated = { ...updated, content: data.content, approval_status: data.approval_status }
      }

      const settings = toSettings(draft)
      const saved = await fetch(`/api/admin/social/posts/${post.id}/tiktok`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ settings }),
      })
      if (!saved.ok) throw new Error(await readApiError(saved, "Couldn't save your TikTok choices."))
      updated = { ...updated, tiktok_settings: settings }

      if (intent === "schedule") {
        onReadyToSchedule(updated)
      } else {
        const res = await fetch(`/api/admin/social/posts/${post.id}/publish-now`, { method: "POST" })
        if (!res.ok) throw new Error(await readApiError(res, "Couldn't send the post."))
        const data = (await res.json()) as Pick<SocialPost, "approval_status" | "scheduled_at">
        onQueued({ ...updated, ...data, rejection_notes: null })
        toast.success(SUCCESS)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message || "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  // A draft needs no privacy choice (that is made in the TikTok app), only a video
  // TikTok will take. Same length rule and shared `busy` as the primary button.
  const draftBlocked = !creator || videoFailed || lengthBlocker(creator, duration) !== null

  async function sendDraft() {
    if (busy || draftBlocked) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/social/posts/${post.id}/tiktok/draft`, { method: "POST" })
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't send the draft."))
      toast.success(DRAFT_SUCCESS)
      // The post itself is unchanged, so the parent is not told (no onQueued).
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message || "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const footerButton = "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"

  return (
    // Escape / overlay click mid-request would let the in-flight send act on a closed (or reopened) dialog.
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <Send className="size-5" />
            Post to TikTok
          </DialogTitle>
          <DialogDescription>Choose how this video appears on TikTok.</DialogDescription>
        </DialogHeader>

        {load.state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking your TikTok account…
          </div>
        )}

        {(load.state === "refused" || load.state === "error") && (
          <p role="alert" className="rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">
            {load.message}
          </p>
        )}

        {creator && load.state === "ready" && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              {creator.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={creator.avatarUrl} alt="" className="size-10 rounded-full object-cover ring-1 ring-border" />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-surface ring-1 ring-border">
                  <UserRound className="size-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Posting to</p>
                <p className="truncate text-sm font-semibold text-foreground">{creator.nickname}</p>
                <p className="truncate text-xs text-muted-foreground">@{creator.username}</p>
              </div>
            </div>

            <video
              src={load.previewUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const seconds = e.currentTarget.duration
                // NaN or Infinity means the length isn't known yet.
                setDuration(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null)
              }}
              onError={() => setVideoFailed(true)}
              className="mx-auto max-h-80 w-full rounded-lg bg-surface ring-1 ring-border"
            />

            <div className="space-y-1">
              <label htmlFor="tiktok-caption" className="text-sm font-medium text-foreground">
                Caption
              </label>
              <textarea
                id="tiktok-caption"
                value={caption}
                maxLength={CAPTION_MAX}
                rows={4}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full rounded-md border border-border bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p
                className={cn(
                  "text-right text-xs",
                  caption.length > CAPTION_MAX ? "text-error" : "text-muted-foreground",
                )}
              >
                {caption.length}/{CAPTION_MAX}
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="tiktok-privacy" className="text-sm font-medium text-foreground">
                Who can view this video
              </label>
              <select
                id="tiktok-privacy"
                value={draft.privacy_level ?? ""}
                onChange={(e) => set("privacy_level", e.target.value as TikTokPostSettings["privacy_level"])}
                className="w-full rounded-md border border-border bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="" disabled>
                  Select who can view
                </option>
                {creator.privacyLevelOptions.map((level) => (
                  <option key={level} value={level} disabled={level === "SELF_ONLY" && draft.branded_content}>
                    {PRIVACY_LABELS[level]}
                  </option>
                ))}
              </select>
              {draft.branded_content && creator.privacyLevelOptions.includes("SELF_ONLY") && (
                <p className="text-xs text-muted-foreground">Branded content can&apos;t be private.</p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">Allow users to</legend>
              <div className="flex flex-wrap gap-5">
                <Box
                  id="tiktok-comment"
                  label="Comment"
                  checked={draft.allow_comment}
                  disabled={creator.commentDisabled}
                  onChange={(v) => set("allow_comment", v)}
                />
                <Box
                  id="tiktok-duet"
                  label="Duet"
                  checked={draft.allow_duet}
                  disabled={creator.duetDisabled}
                  onChange={(v) => set("allow_duet", v)}
                />
                <Box
                  id="tiktok-stitch"
                  label="Stitch"
                  checked={draft.allow_stitch}
                  disabled={creator.stitchDisabled}
                  onChange={(v) => set("allow_stitch", v)}
                />
              </div>
            </fieldset>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="tiktok-disclose" className="text-sm font-medium text-foreground">
                  Disclose video content
                </label>
                <Switch
                  id="tiktok-disclose"
                  checked={draft.disclose}
                  // Turning it off clears both boxes, so nothing hidden is ever sent.
                  onCheckedChange={(on) =>
                    setDraft((d) => ({
                      ...d,
                      disclose: on,
                      your_brand: on && d.your_brand,
                      branded_content: on && d.branded_content,
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Turn on to disclose that this video promotes goods or services in exchange for something of value. Your
                video could promote yourself, a third party, or both.
              </p>
              {draft.disclose && (
                <div className="space-y-3">
                  <Box
                    id="tiktok-your-brand"
                    label="Your brand"
                    help="You are promoting yourself or your own business."
                    checked={draft.your_brand}
                    onChange={(v) => set("your_brand", v)}
                  />
                  <Box
                    id="tiktok-branded-content"
                    label="Branded content"
                    help={
                      draft.privacy_level === "SELF_ONLY"
                        ? "Branded content can't be private."
                        : "You are promoting another brand or a third party."
                    }
                    checked={draft.branded_content}
                    disabled={draft.privacy_level === "SELF_ONLY"}
                    onChange={(v) => set("branded_content", v)}
                  />
                  {disclosureLabel(draft) && (
                    <p className="rounded-md bg-surface px-3 py-2 text-xs text-foreground">{disclosureLabel(draft)}</p>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {"By posting, you agree to TikTok's "}
              {draft.branded_content && (
                <>
                  <Legal href={BC_URL}>Branded Content Policy</Legal>
                  {" and "}
                </>
              )}
              <Legal href={MUSIC_URL}>Music Usage Confirmation</Legal>.
            </p>
          </div>
        )}

        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className={cn(footerButton, "text-muted-foreground hover:bg-surface hover:text-primary")}
            >
              {load.state === "refused" ? "Close" : "Cancel"}
            </button>
            {load.state === "error" && (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={cn(footerButton, "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                Retry
              </button>
            )}
            {load.state === "ready" && intent === "now" && (
              <button
                type="button"
                onClick={sendDraft}
                disabled={draftBlocked || busy}
                className={cn(
                  footerButton,
                  "border border-border bg-white text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                Send to TikTok drafts
              </button>
            )}
            {load.state === "ready" && (
              <button
                type="button"
                onClick={confirm}
                disabled={blocker !== null || busy}
                aria-describedby={blocker ? "tiktok-post-blocker" : undefined}
                className={cn(
                  footerButton,
                  "bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {intent === "now" ? "Post to TikTok" : "Continue to schedule"}
              </button>
            )}
          </div>
          {blocker && (
            <p id="tiktok-post-blocker" className="text-right text-xs text-muted-foreground">
              {blocker}
            </p>
          )}
          {load.state === "ready" && intent === "now" && (
            <p className="text-right text-xs text-muted-foreground">
              Drafts open in the TikTok app, where you add the caption and choose who can see it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Box({
  id,
  label,
  help,
  checked,
  disabled = false,
  onChange,
}: {
  id: string
  label: string
  help?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className={cn("flex items-start gap-2", disabled && "opacity-50")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={help ? `${id}-help` : undefined}
        className="mt-0.5 size-4 accent-primary disabled:cursor-not-allowed"
      />
      <div>
        <label htmlFor={id} className={cn("text-sm text-foreground", disabled && "cursor-not-allowed")}>
          {label}
        </label>
        {help && (
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {help}
          </p>
        )}
      </div>
    </div>
  )
}

function Legal({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
      {children}
    </a>
  )
}
