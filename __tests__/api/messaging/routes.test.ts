import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getConversationById: vi.fn(),
  getOrCreateConversation: vi.fn(),
  listConversationsWithClients: vi.fn(),
  markRead: vi.fn(),
  createMessage: vi.fn(),
  getMessageWithExtras: vi.fn(),
  getMessageConversationId: vi.fn(),
  getAttachmentWithConversation: vi.fn(),
  countReactionsByUser: vi.fn(),
  toggleReaction: vi.fn(),
  listMessages: vi.fn(),
  createAttachmentUploadUrl: vi.fn(),
  verifyUploadedObject: vi.fn(),
  createAttachmentReadUrl: vi.fn(),
  deleteAttachmentObject: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: mocks.recordAudit }))
vi.mock("@/lib/db/conversations", () => ({
  getConversationById: mocks.getConversationById,
  getOrCreateConversation: mocks.getOrCreateConversation,
  listConversationsWithClients: mocks.listConversationsWithClients,
  listConversationsForNotify: vi.fn(),
  getConversationForClient: vi.fn(),
  markRead: mocks.markRead,
}))
vi.mock("@/lib/db/messages", () => ({
  THREAD_PAGE_SIZE: 50,
  listMessages: mocks.listMessages,
  createMessage: mocks.createMessage,
  getMessageWithExtras: mocks.getMessageWithExtras,
  getMessageConversationId: mocks.getMessageConversationId,
  getAttachmentWithConversation: mocks.getAttachmentWithConversation,
  countReactionsByUser: mocks.countReactionsByUser,
  toggleReaction: mocks.toggleReaction,
  listUnnotifiedMessages: vi.fn(),
  stampNotified: vi.fn(),
}))
vi.mock("@/lib/messaging/storage", () => ({
  createAttachmentUploadUrl: mocks.createAttachmentUploadUrl,
  verifyUploadedObject: mocks.verifyUploadedObject,
  createAttachmentReadUrl: mocks.createAttachmentReadUrl,
  deleteAttachmentObject: mocks.deleteAttachmentObject,
}))

import { GET as listConversations, POST as createConversation } from "@/app/api/messaging/conversations/route"
import { POST as markReadRoute } from "@/app/api/messaging/conversations/[id]/read/route"
import { POST as uploadUrlRoute } from "@/app/api/messaging/attachments/upload-url/route"
import { POST as sendMessage } from "@/app/api/messaging/messages/route"
import { POST as reactRoute } from "@/app/api/messaging/messages/[id]/reactions/route"
import { GET as attachmentRoute } from "@/app/api/messaging/attachments/[id]/route"

const CONV_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_CONV_ID = "22222222-2222-4222-8222-222222222222"
const CLIENT_ID = "33333333-3333-4333-8333-333333333333"
const MSG_ID = "44444444-4444-4444-8444-444444444444"

const conversation = { id: CONV_ID, client_user_id: CLIENT_ID, client_last_read_at: null, admin_last_read_at: null }

const adminSession = { user: { id: "admin-1", role: "admin" } }
const clientSession = { user: { id: CLIENT_ID, role: "client" } }
const strangerSession = { user: { id: "someone-else", role: "client" } }

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConversationById.mockResolvedValue(conversation)
  mocks.listConversationsWithClients.mockResolvedValue([])
  mocks.getOrCreateConversation.mockResolvedValue(conversation)
  mocks.markRead.mockImplementation(async (_id: string, _side: string) => "2026-08-04T12:00:00Z")
})

describe("GET /api/messaging/conversations", () => {
  it("401 when signed out", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await listConversations()).status).toBe(401)
  })

  it("creates the client's conversation on first read so there is a thread to open", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    await listConversations()
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith(CLIENT_ID)
    expect(mocks.listConversationsWithClients).toHaveBeenCalledWith("client", CLIENT_ID)
  })

  it("does not auto-create anything for an admin", async () => {
    mocks.auth.mockResolvedValueOnce(adminSession)
    await listConversations()
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled()
    expect(mocks.listConversationsWithClients).toHaveBeenCalledWith("admin", "admin-1")
  })
})

describe("POST /api/messaging/conversations", () => {
  it("403 for a client — only the coach opens a thread with someone", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await createConversation(post("/api/messaging/conversations", { client_user_id: CLIENT_ID }))
    expect(res.status).toBe(403)
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled()
  })

  it("admin get-or-creates and records an audit row", async () => {
    mocks.auth.mockResolvedValueOnce(adminSession)
    const res = await createConversation(post("/api/messaging/conversations", { client_user_id: CLIENT_ID }))
    expect(res.status).toBe(200)
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "messaging.conversation_created",
        target: { type: "conversation", id: CONV_ID },
      }),
    )
  })
})

describe("POST /api/messaging/conversations/[id]/read", () => {
  const params = { params: Promise.resolve({ id: CONV_ID }) }

  it("403 when a different client asks", async () => {
    mocks.auth.mockResolvedValueOnce(strangerSession)
    const res = await markReadRoute(post(`/api/messaging/conversations/${CONV_ID}/read`, {}), params)
    expect(res.status).toBe(403)
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it("stamps ONLY the caller's side", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await markReadRoute(post(`/api/messaging/conversations/${CONV_ID}/read`, {}), params)
    expect(res.status).toBe(200)
    // Exactly once: stamping both sides would mark the coach's messages read
    // the moment the client opened the thread, and the delayed email leans on
    // these timestamps being honest.
    expect(mocks.markRead).toHaveBeenCalledTimes(1)
    expect(mocks.markRead).toHaveBeenCalledWith(CONV_ID, "client")
    expect(await res.json()).toMatchObject({ side: "client" })
  })

  it("stamps the admin side for the coach", async () => {
    mocks.auth.mockResolvedValueOnce(adminSession)
    await markReadRoute(post(`/api/messaging/conversations/${CONV_ID}/read`, {}), params)
    expect(mocks.markRead).toHaveBeenCalledWith(CONV_ID, "admin")
  })
})

describe("POST /api/messaging/attachments/upload-url", () => {
  beforeEach(() => {
    mocks.createAttachmentUploadUrl.mockImplementation(async ({ storagePath }: { storagePath: string }) => ({
      uploadUrl: `https://signed.example/${storagePath}`,
      storagePath,
      expiresInSeconds: 900,
    }))
  })

  const file = (over = {}) => ({ filename: "clip.mp4", mime_type: "video/mp4", byte_size: 1024, ...over })

  it("403 when a client asks for an upload URL on someone else's conversation", async () => {
    mocks.auth.mockResolvedValueOnce(strangerSession)
    const res = await uploadUrlRoute(
      post("/api/messaging/attachments/upload-url", { conversation_id: CONV_ID, files: [file()] }),
    )
    expect(res.status).toBe(403)
    expect(mocks.createAttachmentUploadUrl).not.toHaveBeenCalled()
  })

  it("400 on an oversize declared size", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await uploadUrlRoute(
      post("/api/messaging/attachments/upload-url", {
        conversation_id: CONV_ID,
        files: [file({ byte_size: 26 * 1024 * 1024 })],
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/25 MB/)
    expect(mocks.createAttachmentUploadUrl).not.toHaveBeenCalled()
  })

  it("400 on a disallowed mime type", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await uploadUrlRoute(
      post("/api/messaging/attachments/upload-url", {
        conversation_id: CONV_ID,
        files: [file({ mime_type: "application/pdf", filename: "invoice.pdf" })],
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.createAttachmentUploadUrl).not.toHaveBeenCalled()
  })

  it("signs one URL per file under the conversation's prefix", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await uploadUrlRoute(
      post("/api/messaging/attachments/upload-url", {
        conversation_id: CONV_ID,
        files: [file(), file({ filename: "photo.png", mime_type: "image/png" })],
      }),
    )
    expect(res.status).toBe(200)
    const { uploads } = await res.json()
    expect(uploads).toHaveLength(2)
    for (const upload of uploads) {
      expect(upload.storage_path).toMatch(new RegExp(`^messaging/${CONV_ID}/`))
    }
  })
})

describe("POST /api/messaging/messages", () => {
  beforeEach(() => {
    mocks.createMessage.mockResolvedValue({ message_id: MSG_ID, created_at: "2026-08-04T12:00:00Z" })
    mocks.getMessageWithExtras.mockResolvedValue({ id: MSG_ID, attachments: [], reactions: [] })
    mocks.verifyUploadedObject.mockResolvedValue({ ok: true, size: 2048, contentType: "image/png" })
    mocks.deleteAttachmentObject.mockResolvedValue(undefined)
  })

  it("rejects a message with neither body nor attachments", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await sendMessage(post("/api/messaging/messages", { conversation_id: CONV_ID, body: "   " }))
    expect(res.status).toBe(400)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("403 for a non-participant", async () => {
    mocks.auth.mockResolvedValueOnce(strangerSession)
    const res = await sendMessage(post("/api/messaging/messages", { conversation_id: CONV_ID, body: "hi" }))
    expect(res.status).toBe(403)
  })

  it("stores sender_role from the SESSION, so a client cannot post as the coach", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await sendMessage(
      post("/api/messaging/messages", { conversation_id: CONV_ID, body: "hi", sender_role: "admin" }),
    )
    expect(res.status).toBe(201)
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({ sender_role: "client" }))
  })

  // The case the declared-size check in upload-url cannot catch: a signed PUT
  // URL constrains Content-Type but NOT length.
  it("deletes the object and 413s when the REAL uploaded size is over the cap", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.verifyUploadedObject.mockResolvedValueOnce({ ok: false, reason: "too_large" })
    const path = `messaging/${CONV_ID}/up-1/huge.mp4`

    const res = await sendMessage(
      post("/api/messaging/messages", { conversation_id: CONV_ID, attachments: [{ storage_path: path }] }),
    )

    expect(res.status).toBe(413)
    expect(mocks.deleteAttachmentObject).toHaveBeenCalledWith(path)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("deletes the object and 400s when the real content type is not allowed", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.verifyUploadedObject.mockResolvedValueOnce({ ok: false, reason: "wrong_type" })
    const path = `messaging/${CONV_ID}/up-1/notes.txt`
    const res = await sendMessage(
      post("/api/messaging/messages", { conversation_id: CONV_ID, attachments: [{ storage_path: path }] }),
    )
    expect(res.status).toBe(400)
    expect(mocks.deleteAttachmentObject).toHaveBeenCalledWith(path)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("rejects an attachment path belonging to another conversation", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await sendMessage(
      post("/api/messaging/messages", {
        conversation_id: CONV_ID,
        attachments: [{ storage_path: `messaging/${OTHER_CONV_ID}/up-1/theirs.png` }],
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("takes kind and mime from the verified object, not the client's claim", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.verifyUploadedObject.mockResolvedValueOnce({ ok: true, size: 999, contentType: "video/mp4" })
    await sendMessage(
      post("/api/messaging/messages", {
        conversation_id: CONV_ID,
        attachments: [{ storage_path: `messaging/${CONV_ID}/up-1/clip.mp4` }],
      }),
    )
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ kind: "video", mime_type: "video/mp4", byte_size: 999 })],
        preview: "Video",
      }),
    )
  })
})

describe("POST /api/messaging/messages/[id]/reactions", () => {
  const params = { params: Promise.resolve({ id: MSG_ID }) }

  beforeEach(() => {
    mocks.getMessageConversationId.mockResolvedValue(CONV_ID)
    mocks.countReactionsByUser.mockResolvedValue(0)
    mocks.toggleReaction.mockResolvedValue({ added: true, reaction: { id: "r1", emoji: "👍" } })
  })

  it("400 on non-emoji text", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "nice" }), params)
    expect(res.status).toBe(400)
    expect(mocks.toggleReaction).not.toHaveBeenCalled()
  })

  it("403 when the message is in someone else's conversation", async () => {
    mocks.auth.mockResolvedValueOnce(strangerSession)
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "👍" }), params)
    expect(res.status).toBe(403)
    expect(mocks.toggleReaction).not.toHaveBeenCalled()
  })

  it("adds a reaction", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "👍" }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ added: true })
  })

  it("reports removal when the same emoji is sent again", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.toggleReaction.mockResolvedValueOnce({ added: false, reaction: null })
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "👍" }), params)
    expect(await res.json()).toMatchObject({ added: false })
  })

  it("429s past the per-user cap and undoes the add", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.countReactionsByUser.mockResolvedValueOnce(6)
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "🎉" }), params)
    expect(res.status).toBe(429)
    expect(mocks.toggleReaction).toHaveBeenCalledTimes(2)
  })

  it("still lets a capped user REMOVE a reaction", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    mocks.countReactionsByUser.mockResolvedValueOnce(6)
    mocks.toggleReaction.mockResolvedValueOnce({ added: false, reaction: null })
    const res = await reactRoute(post(`/api/messaging/messages/${MSG_ID}/reactions`, { emoji: "👍" }), params)
    expect(res.status).toBe(200)
    expect(mocks.toggleReaction).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/messaging/attachments/[id]", () => {
  const params = { params: Promise.resolve({ id: "att-1" }) }
  const get = (url: string) => new NextRequest(`http://localhost${url}`)

  beforeEach(() => {
    mocks.getAttachmentWithConversation.mockResolvedValue({
      id: "att-1",
      conversation_id: CONV_ID,
      storage_path: `messaging/${CONV_ID}/up-1/photo.png`,
      kind: "image",
      mime_type: "image/png",
      byte_size: 100,
      width: 10,
      height: 10,
      duration_seconds: null,
      original_filename: "photo.png",
    })
    let n = 0
    mocks.createAttachmentReadUrl.mockImplementation(async () => `https://signed.example/photo.png?sig=${++n}`)
  })

  it("403 for a non-participant", async () => {
    mocks.auth.mockResolvedValueOnce(strangerSession)
    const res = await attachmentRoute(get("/api/messaging/attachments/att-1?redirect=1"), params)
    expect(res.status).toBe(403)
  })

  it("302s to a freshly signed URL, and the signature differs per hit", async () => {
    mocks.auth.mockResolvedValue(clientSession)
    const first = await attachmentRoute(get("/api/messaging/attachments/att-1?redirect=1"), params)
    const second = await attachmentRoute(get("/api/messaging/attachments/att-1?redirect=1"), params)

    expect(first.status).toBe(302)
    expect(first.headers.get("cache-control")).toBe("no-store")
    // A durable signed URL would be identical here — and expired by next week.
    expect(first.headers.get("location")).not.toBe(second.headers.get("location"))
  })

  it("returns metadata as JSON without the redirect flag", async () => {
    mocks.auth.mockResolvedValueOnce(clientSession)
    const res = await attachmentRoute(get("/api/messaging/attachments/att-1"), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ kind: "image", mime_type: "image/png" })
  })
})
