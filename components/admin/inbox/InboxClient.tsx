"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Inbox as InboxIcon,
  RefreshCw,
  Search,
  Send,
  Loader2,
  CornerDownLeft,
  Unplug,
  X,
  PenSquare,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface ThreadListItem {
  id: string
  snippet: string
  messageCount: number
  isUnread: boolean
  from: string
  to: string
  subject: string
  date: string
  internalDate: string
}

interface ThreadMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  internalDate: string
  isUnread: boolean
  from: string
  to: string
  cc: string | null
  subject: string
  date: string
  messageId: string | null
  references: string | null
  bodyText: string
  bodyHtml: string
}

interface DecodedThread {
  id: string
  snippet: string
  messages: ThreadMessage[]
}

interface InboxClientProps {
  connectedEmail: string
}

const PRESETS: { label: string; q: string }[] = [
  { label: "Inbox", q: "in:inbox" },
  { label: "Unread", q: "in:inbox is:unread" },
  { label: "Primary", q: "in:inbox category:primary" },
  { label: "All mail", q: "in:anywhere -in:spam -in:trash" },
  { label: "Sent", q: "in:sent" },
]

export function InboxClient({ connectedEmail }: InboxClientProps) {
  const searchParams = useSearchParams()
  const [threads, setThreads] = useState<ThreadListItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [activePreset, setActivePreset] = useState<string>("in:inbox")
  const [search, setSearch] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("in:inbox")

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thread, setThread] = useState<DecodedThread | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)

  // Surface the OAuth callback flash messages.
  useEffect(() => {
    const connected = searchParams.get("connected")
    const error = searchParams.get("error")
    const disconnected = searchParams.get("disconnected")
    if (connected) toast.success("Gmail connected")
    if (disconnected) toast.success("Gmail disconnected")
    if (error) toast.error(error)
  }, [searchParams])

  const loadThreads = useCallback(async (q: string) => {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/admin/inbox/threads?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { threads: ThreadListItem[] }
      setThreads(data.threads ?? [])
    } catch (err) {
      toast.error(`Failed to load inbox: ${(err as Error).message}`)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads(appliedQuery)
  }, [appliedQuery, loadThreads])

  const selectThread = useCallback(async (id: string) => {
    setSelectedId(id)
    setThread(null)
    setReply("")
    setLoadingThread(true)
    try {
      const res = await fetch(`/api/admin/inbox/threads/${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { thread: DecodedThread }
      setThread(data.thread)
      // Optimistically clear unread on the list row.
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, isUnread: false } : t)))
    } catch (err) {
      toast.error(`Failed to open thread: ${(err as Error).message}`)
    } finally {
      setLoadingThread(false)
    }
  }, [])

  const sendReplyHandler = useCallback(async () => {
    if (!selectedId || !reply.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch("/api/admin/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedId, body: reply.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast.success("Reply sent")
      setReply("")
      // Refresh thread + list so the sent message appears.
      await selectThread(selectedId)
      void loadThreads(appliedQuery)
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [selectedId, reply, sending, selectThread, loadThreads, appliedQuery])

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = search.trim()
    if (!trimmed) {
      setActivePreset("in:inbox")
      setAppliedQuery("in:inbox")
      return
    }
    setActivePreset("")
    setAppliedQuery(trimmed)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
            <InboxIcon className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-primary">Inbox</h1>
            <p className="text-xs text-muted-foreground">
              Connected as <span className="font-mono">{connectedEmail || "—"}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            <PenSquare className="size-3.5" />
            Compose
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadThreads(appliedQuery)}
            disabled={loadingList}
          >
            {loadingList ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
          <form action="/api/integrations/gmail/disconnect" method="post">
            <Button variant="outline" size="sm" type="submit" className="text-muted-foreground">
              <Unplug className="size-3.5" />
              Disconnect
            </Button>
          </form>
        </div>
      </div>

      {/* Search + presets */}
      <div className="mb-4 space-y-2">
        <form onSubmit={submitSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Gmail search — e.g. from:lead@example.com is:unread'
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.q}
              type="button"
              onClick={() => {
                setSearch("")
                setActivePreset(p.q)
                setAppliedQuery(p.q)
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activePreset === p.q
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-white text-muted-foreground hover:text-primary",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* List + detail layout */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* Thread list */}
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          {loadingList ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
            </div>
          ) : threads.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              No messages match this view.
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[calc(100vh-260px)] overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => selectThread(t.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-surface",
                      selectedId === t.id ? "bg-primary/5" : "",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {t.isUnread ? (
                        <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-accent" />
                      ) : (
                        <span aria-hidden className="size-2 shrink-0" />
                      )}
                      <p
                        className={cn(
                          "truncate text-sm flex-1",
                          t.isUnread ? "font-semibold text-primary" : "text-foreground",
                        )}
                      >
                        {parseDisplayName(t.from)}
                      </p>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelativeDate(t.internalDate, t.date)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 truncate text-sm",
                        t.isUnread ? "font-medium text-primary" : "text-foreground",
                      )}
                    >
                      {t.subject}
                      {t.messageCount > 1 ? (
                        <span className="ml-1 text-xs text-muted-foreground">({t.messageCount})</span>
                      ) : null}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{t.snippet}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Thread detail */}
        <div className="rounded-xl border border-border bg-white">
          {!selectedId ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              Select a conversation to read it.
            </div>
          ) : loadingThread ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading thread…
            </div>
          ) : thread ? (
            <ThreadView
              thread={thread}
              connectedEmail={connectedEmail}
              reply={reply}
              setReply={setReply}
              sending={sending}
              onSend={sendReplyHandler}
              onClose={() => {
                setSelectedId(null)
                setThread(null)
              }}
            />
          ) : null}
        </div>
      </div>

      {composeOpen ? (
        <ComposeDialog
          fromEmail={connectedEmail}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false)
            void loadThreads(appliedQuery)
          }}
        />
      ) : null}
    </div>
  )
}

function ComposeDialog({
  fromEmail,
  onClose,
  onSent,
}: {
  fromEmail: string
  onClose: () => void
  onSent: () => void
}) {
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  const canSend = to.trim() && subject.trim() && body.trim() && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const res = await fetch("/api/admin/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          subject: subject.trim(),
          body: body.trim(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      toast.success("Message sent")
      onSent()
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <PenSquare className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">New message</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-primary"
            aria-label="Close compose"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="text-xs text-muted-foreground">
            From <span className="font-mono">{fromEmail || "—"}</span>
          </div>
          <Input
            type="email"
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Cc (optional)"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          />
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="Write your message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="resize-y"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSend()} disabled={!canSend} className="gap-1.5">
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function ThreadView({
  thread,
  connectedEmail,
  reply,
  setReply,
  sending,
  onSend,
  onClose,
}: {
  thread: DecodedThread
  connectedEmail: string
  reply: string
  setReply: (v: string) => void
  sending: boolean
  onSend: () => void | Promise<void>
  onClose: () => void
}) {
  const subject = thread.messages[0]?.subject ?? "(no subject)"
  const lastMessage = thread.messages[thread.messages.length - 1]
  const replyTarget = useMemo(() => {
    if (!lastMessage) return ""
    const sender = parseAddress(lastMessage.from)
    if (sender && sender.toLowerCase() === connectedEmail.toLowerCase()) {
      return parseDisplayName(lastMessage.to)
    }
    return parseDisplayName(lastMessage.from)
  }, [lastMessage, connectedEmail])

  return (
    <div className="flex h-full max-h-[calc(100vh-220px)] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-primary">{subject}</h2>
          <p className="text-xs text-muted-foreground">
            {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-primary"
          aria-label="Close conversation"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {thread.messages.map((m) => (
          <MessageCard key={m.id} message={m} connectedEmail={connectedEmail} />
        ))}
      </div>

      <div className="border-t border-border px-5 py-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="size-3.5" />
          <span>
            Reply to <span className="font-medium text-foreground">{replyTarget || "—"}</span>
          </span>
        </div>
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply…"
          rows={5}
          className="resize-y"
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void onSend()}
            disabled={sending || !reply.trim()}
            className="gap-1.5"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageCard({
  message,
  connectedEmail,
}: {
  message: ThreadMessage
  connectedEmail: string
}) {
  const fromAddress = parseAddress(message.from)
  const fromMe = fromAddress && fromAddress.toLowerCase() === connectedEmail.toLowerCase()
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        fromMe ? "border-primary/30 bg-primary/5" : "border-border bg-white",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-primary">
            {fromMe ? "You" : parseDisplayName(message.from)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              &lt;{fromAddress}&gt;
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">to {parseDisplayName(message.to)}</p>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">{formatFullDate(message.internalDate, message.date)}</p>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-foreground">
        {message.bodyText ? (
          <pre className="whitespace-pre-wrap break-words font-body">{message.bodyText}</pre>
        ) : message.bodyHtml ? (
          <div
            className="prose prose-sm max-w-none [&_a]:text-accent [&_a]:underline"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.bodyHtml) }}
          />
        ) : (
          <p className="text-muted-foreground italic">{message.snippet || "(empty message)"}</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────

function parseAddress(headerValue: string): string {
  if (!headerValue) return ""
  const m = headerValue.match(/<([^>]+)>/)
  return (m?.[1] ?? headerValue).trim()
}

function parseDisplayName(headerValue: string): string {
  if (!headerValue) return ""
  const m = headerValue.match(/^(.+?)\s*<[^>]+>$/)
  if (m?.[1]) return m[1].replace(/^"|"$/g, "")
  return parseAddress(headerValue)
}

function formatRelativeDate(internalDate: string, fallback: string): string {
  const ts = Number(internalDate)
  const date = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(fallback)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" })
}

function formatFullDate(internalDate: string, fallback: string): string {
  const ts = Number(internalDate)
  const date = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date(fallback)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Tiny defensive sanitizer so we don't render <script> from message HTML.
// Gmail messages come from the user's own mailbox, but inbound HTML is still
// untrusted relative to our admin chrome. For a beefier solution, swap in
// DOMPurify; for now we strip script/style/iframe and inline event handlers.
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
}
