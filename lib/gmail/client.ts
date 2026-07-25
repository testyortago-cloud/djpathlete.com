// lib/gmail/client.ts
// Thin Gmail REST API wrapper used by /api/admin/inbox/* routes. Each call
// takes an access token (callers refresh via getAccessTokenForConnection
// below). Message bodies are decoded from base64url; multipart messages walk
// to the first text/plain or text/html part.

import {
  getPlatformConnection, connectPlatform, setConnectionError, clearConnectionError,
} from "@/lib/db/platform-connections"
import { refreshAccessToken } from "@/lib/gmail/oauth"

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailMessagePart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailMessagePart
}

export interface GmailThread {
  id: string
  historyId?: string
  snippet?: string
  messages?: GmailMessage[]
}

export interface GmailThreadListItem {
  id: string
  snippet?: string
  historyId?: string
}

export interface ListThreadsResponse {
  threads?: GmailThreadListItem[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface DecodedMessage {
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

export interface DecodedThread {
  id: string
  snippet: string
  messages: DecodedMessage[]
}

interface ConnectionCredentials {
  refresh_token?: string
  scope?: string
  authorized_user_id?: string
  authorized_at?: string
}

/**
 * Fetches the stored Gmail connection, refreshes its access token, and
 * returns the access token plus the connected email address. Throws if no
 * connection exists or the refresh fails (also marks the connection 'error').
 *
 * STATUS LIFECYCLE: 'error' is RETRYABLE, not terminal. The refresh token is
 * still on the row, and the overwhelmingly common cause of 'error' is a
 * transient Google blip during a refresh — not a revoked grant. Because
 * fn_connect_platform (interactive OAuth consent) was the only writer of
 * status='connected', treating 'error' as unusable meant one blip retired the
 * whole integration (inbox AND the hourly receipt poller) until a human
 * noticed. So: attempt the refresh from 'error' too, and clear the flag the
 * moment it succeeds. 'paused' and 'disconnected' remain hard stops — those
 * are deliberate human states.
 */
export async function getAccessTokenForConnection(): Promise<{
  accessToken: string
  emailAddress: string | null
}> {
  const conn = await getPlatformConnection("gmail")
  if (!conn || (conn.status !== "connected" && conn.status !== "error")) {
    throw new GmailNotConnectedError()
  }
  const creds = (conn.credentials ?? {}) as ConnectionCredentials
  const refresh_token = creds.refresh_token
  if (!refresh_token) throw new GmailNotConnectedError()

  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET)")
  }

  try {
    const tokens = await refreshAccessToken({
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    })
    if (conn.status === "error") {
      // Self-heal: best-effort so a flaky write never turns a working refresh
      // into a thrown request.
      await clearConnectionError("gmail").catch(() => {})
    }
    return { accessToken: tokens.access_token, emailAddress: conn.account_handle }
  } catch (err) {
    await setConnectionError("gmail", (err as Error).message).catch(() => {})
    throw err
  }
}

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail is not connected")
    this.name = "GmailNotConnectedError"
  }
}

async function gmailFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  return res
}

export async function getProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await gmailFetch(accessToken, "/profile")
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail profile fetch failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as { emailAddress: string }
}

export async function listThreads(
  accessToken: string,
  opts: { q?: string; pageToken?: string; maxResults?: number; labelIds?: string[] } = {},
): Promise<ListThreadsResponse> {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.pageToken) params.set("pageToken", opts.pageToken)
  params.set("maxResults", String(opts.maxResults ?? 25))
  for (const id of opts.labelIds ?? []) params.append("labelIds", id)
  const res = await gmailFetch(accessToken, `/threads?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail listThreads failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as ListThreadsResponse
}

export async function getThread(accessToken: string, threadId: string): Promise<GmailThread> {
  const res = await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}?format=full`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail getThread failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as GmailThread
}

export async function getMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  const headers = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "References", "In-Reply-To"]
  const params = new URLSearchParams({ format: "metadata" })
  for (const h of headers) params.append("metadataHeaders", h)
  const res = await gmailFetch(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail getMessage failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as GmailMessage
}

// ─── Receipt-poller helpers (Track C) ─────────────────────────────────────

export interface GmailLabel {
  id: string
  name: string
  type?: string
}

export async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await gmailFetch(accessToken, "/labels")
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail listLabels failed: HTTP ${res.status} ${text}`)
  }
  const json = (await res.json()) as { labels?: GmailLabel[] }
  return json.labels ?? []
}

export interface GmailMessageListItem {
  id: string
  threadId: string
}

export interface ListMessagesResponse {
  messages?: GmailMessageListItem[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export async function listMessages(
  accessToken: string,
  opts: { labelIds?: string[]; pageToken?: string; maxResults?: number; q?: string } = {},
): Promise<ListMessagesResponse> {
  const params = new URLSearchParams()
  if (opts.q) params.set("q", opts.q)
  if (opts.pageToken) params.set("pageToken", opts.pageToken)
  params.set("maxResults", String(opts.maxResults ?? 25))
  for (const id of opts.labelIds ?? []) params.append("labelIds", id)
  const res = await gmailFetch(accessToken, `/messages?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail listMessages failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as ListMessagesResponse
}

/** Full-format single message — payload parts + attachment ids included.
 *  (getMessageMetadata above is format=metadata and has neither.) */
export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const res = await gmailFetch(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // "(full)" keeps this distinguishable from getMessageMetadata's failure above
    // when it lands in a cron_runs detail.
    throw new Error(`Gmail getMessage(full) failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as GmailMessage
}

/** users.messages.attachments.get — Gmail returns base64url body data. */
export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await gmailFetch(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail getAttachment failed: HTTP ${res.status} ${text}`)
  }
  const json = (await res.json()) as { size?: number; data?: string }
  const data = json.data ?? ""
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  const buf = Buffer.from(padded, "base64")
  // Never degrade to 0 bytes: the poller writes its idempotency key (external_ref
  // 'gmail:<messageId>:<i>') as soon as it ingests, and later polls skip the whole
  // message on a prefix hit — an empty document would burn that key permanently.
  // A 200 without usable bytes must fail the message loudly instead.
  if (buf.length === 0) {
    throw new Error(`Gmail getAttachment returned no data for ${messageId}/${attachmentId}`)
  }
  return buf
}

export async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  opts: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  const res = await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: opts.addLabelIds ?? [],
      removeLabelIds: opts.removeLabelIds ?? [],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail modify failed: HTTP ${res.status} ${text}`)
  }
}

export interface SendMessageInput {
  accessToken: string
  fromEmail: string
  fromName?: string
  to: string
  cc?: string
  subject: string
  bodyText: string
  // Reply context. Omit all three to send a brand-new conversation.
  threadId?: string
  inReplyTo?: string | null
  references?: string | null
}

export async function sendMessage(input: SendMessageInput): Promise<{ id: string; threadId: string }> {
  const raw = buildRfc822Message({
    from: input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    bodyText: input.bodyText,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references ?? null,
  })
  const body: { raw: string; threadId?: string } = { raw }
  if (input.threadId) body.threadId = input.threadId
  const res = await gmailFetch(input.accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Gmail send failed: HTTP ${res.status} ${text}`)
  }
  return (await res.json()) as { id: string; threadId: string }
}

/**
 * One-time persistence helper after OAuth callback. Stores the refresh token
 * and the connected email as account_handle so the inbox UI can display it.
 */
export async function persistGmailConnection(args: {
  refresh_token: string
  scope: string
  emailAddress: string
  authorized_user_id: string
}): Promise<void> {
  await connectPlatform("gmail", {
    credentials: {
      refresh_token: args.refresh_token,
      scope: args.scope,
      authorized_user_id: args.authorized_user_id,
      authorized_at: new Date().toISOString(),
    },
    account_handle: args.emailAddress,
    connected_by: args.authorized_user_id,
  })
}

// ─────────────────────────────────────────────────────────────────
// Decoding helpers
// ─────────────────────────────────────────────────────────────────

function base64UrlDecode(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  return Buffer.from(padded, "base64").toString("utf8")
}

function findHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value
  }
  return null
}

function walkParts(part: GmailMessagePart | undefined, mime: "text/plain" | "text/html"): string {
  if (!part) return ""
  if (part.mimeType === mime && part.body?.data) {
    return base64UrlDecode(part.body.data)
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = walkParts(child, mime)
      if (found) return found
    }
  }
  return ""
}

export function decodeMessage(msg: GmailMessage): DecodedMessage {
  const headers = msg.payload?.headers
  const from = findHeader(headers, "From") ?? ""
  const to = findHeader(headers, "To") ?? ""
  const cc = findHeader(headers, "Cc")
  const subject = findHeader(headers, "Subject") ?? "(no subject)"
  const date = findHeader(headers, "Date") ?? ""
  const messageId = findHeader(headers, "Message-ID") ?? findHeader(headers, "Message-Id")
  const references = findHeader(headers, "References") ?? findHeader(headers, "In-Reply-To")

  let bodyText = walkParts(msg.payload, "text/plain")
  let bodyHtml = walkParts(msg.payload, "text/html")

  if (!bodyText && !bodyHtml && msg.payload?.body?.data) {
    const decoded = base64UrlDecode(msg.payload.body.data)
    if (msg.payload.mimeType === "text/html") bodyHtml = decoded
    else bodyText = decoded
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    internalDate: msg.internalDate ?? "",
    isUnread: (msg.labelIds ?? []).includes("UNREAD"),
    from,
    to,
    cc,
    subject,
    date,
    messageId,
    references,
    bodyText,
    bodyHtml,
  }
}

export function decodeThread(thread: GmailThread): DecodedThread {
  return {
    id: thread.id,
    snippet: thread.snippet ?? "",
    messages: (thread.messages ?? []).map(decodeMessage),
  }
}

// ─────────────────────────────────────────────────────────────────
// RFC 822 builder for replies
// ─────────────────────────────────────────────────────────────────

function encodeMimeWord(value: string): string {
  // Only encode if the value has non-ASCII characters; otherwise leave
  // as-is. Subjects with emoji/accents need RFC 2047 encoded-word form.
  // Using B-encoded UTF-8 to keep the encoder trivial and correct.
  // eslint-disable-next-line no-control-regex
  const needs = /[^\x00-\x7F]/.test(value)
  if (!needs) return value
  const b64 = Buffer.from(value, "utf8").toString("base64")
  return `=?UTF-8?B?${b64}?=`
}

interface BuildMessageInput {
  from: string
  to: string
  cc?: string
  subject: string
  bodyText: string
  inReplyTo: string | null
  references: string | null
}

function buildRfc822Message(input: BuildMessageInput): string {
  const lines: string[] = []
  lines.push(`From: ${input.from}`)
  lines.push(`To: ${input.to}`)
  if (input.cc) lines.push(`Cc: ${input.cc}`)
  lines.push(`Subject: ${encodeMimeWord(input.subject)}`)
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`)
  if (input.references) lines.push(`References: ${input.references}`)
  lines.push("MIME-Version: 1.0")
  lines.push('Content-Type: text/plain; charset="UTF-8"')
  lines.push("Content-Transfer-Encoding: 8bit")
  lines.push("")
  lines.push(input.bodyText)
  const raw = lines.join("\r\n")
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
