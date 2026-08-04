import { describe, it, expect } from "vitest"
import { messagesNeedingEmail, alreadyReadIds } from "@/lib/messaging/notify-select"
import type { Conversation, Message } from "@/types/database"

// The fixture year deliberately differs from the current year. A test whose
// dates come from "now" passes against an implementation that ignores the
// delay entirely — it would be asserting nothing.
const T0 = Date.parse("2024-05-01T10:00:00Z")
const MIN = 60_000

function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    client_user_id: "client-1",
    created_at: "2024-01-01T00:00:00Z",
    last_message_at: null,
    last_message_preview: null,
    last_message_sender_role: null,
    client_last_read_at: null,
    admin_last_read_at: null,
    ...over,
  }
}

function message(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_user_id: "admin-1",
    sender_role: "admin",
    body: "Hello",
    attachment_count: 0,
    created_at: new Date(T0).toISOString(),
    email_notified_at: null,
    ...over,
  }
}

const input = (messages: Message[], conversations: Conversation[], nowOffsetMs: number) => ({
  messages,
  conversations,
  now: T0 + nowOffsetMs,
  delayMs: 5 * MIN,
})

describe("messagesNeedingEmail", () => {
  it("does not email before the delay has elapsed", () => {
    expect(messagesNeedingEmail(input([message()], [conversation()], 4 * MIN))).toEqual([])
  })

  it("emails the client when the coach's message is still unread after the delay", () => {
    const groups = messagesNeedingEmail(input([message()], [conversation()], 6 * MIN))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      conversation_id: "c1",
      recipient_role: "client",
      recipient_user_id: "client-1",
      message_ids: ["m1"],
    })
  })

  it("sends nothing when the recipient already read it", () => {
    const read = conversation({ client_last_read_at: new Date(T0 + MIN).toISOString() })
    expect(messagesNeedingEmail(input([message()], [read], 6 * MIN))).toEqual([])
  })

  it("still stamps a read message so it is never reconsidered", () => {
    const read = conversation({ client_last_read_at: new Date(T0 + MIN).toISOString() })
    expect(alreadyReadIds(input([message()], [read], 6 * MIN))).toEqual(["m1"])
  })

  it("does not stamp a message that is still within the delay window", () => {
    expect(alreadyReadIds(input([message()], [conversation()], 4 * MIN))).toEqual([])
  })

  it("skips messages that were already notified", () => {
    const notified = message({ email_notified_at: new Date(T0).toISOString() })
    expect(messagesNeedingEmail(input([notified], [conversation()], 6 * MIN))).toEqual([])
    expect(alreadyReadIds(input([notified], [conversation()], 6 * MIN))).toEqual([])
  })

  it("bundles several unread messages into one group per recipient", () => {
    const messages = [
      message({ id: "m1", body: "one" }),
      message({ id: "m2", body: "two", created_at: new Date(T0 + 30_000).toISOString() }),
    ]
    const groups = messagesNeedingEmail(input(messages, [conversation()], 6 * MIN))
    expect(groups).toHaveLength(1)
    expect(groups[0].message_ids).toEqual(["m1", "m2"])
    expect(groups[0].previews).toEqual(["one", "two"])
  })

  it("routes a client's message to the shared admin inbox", () => {
    const fromClient = message({ sender_role: "client", sender_user_id: "client-1" })
    const groups = messagesNeedingEmail(input([fromClient], [conversation()], 6 * MIN))
    expect(groups[0]).toMatchObject({ recipient_role: "admin", recipient_user_id: null })
  })

  it("compares a client's message against the admin's read stamp, not the client's", () => {
    // The client having read their own message must not suppress the coach's email.
    const conv = conversation({ client_last_read_at: new Date(T0 + MIN).toISOString() })
    const fromClient = message({ sender_role: "client", sender_user_id: "client-1" })
    expect(messagesNeedingEmail(input([fromClient], [conv], 6 * MIN))).toHaveLength(1)
  })

  it("holds back a recent message while emailing an older one in the same conversation", () => {
    const messages = [
      message({ id: "old" }),
      message({ id: "fresh", created_at: new Date(T0 + 5.5 * MIN).toISOString() }),
    ]
    const groups = messagesNeedingEmail(input(messages, [conversation()], 6 * MIN))
    expect(groups[0].message_ids).toEqual(["old"])
  })

  it("describes an attachment-only message in the preview", () => {
    const attachmentOnly = message({ body: null, attachment_count: 2 })
    const groups = messagesNeedingEmail(input([attachmentOnly], [conversation()], 6 * MIN))
    expect(groups[0].previews).toEqual(["Sent an attachment"])
  })

  it("keeps two conversations in separate groups", () => {
    const conversations = [conversation(), conversation({ id: "c2", client_user_id: "client-2" })]
    const messages = [message({ id: "m1" }), message({ id: "m2", conversation_id: "c2" })]
    const groups = messagesNeedingEmail(input(messages, conversations, 6 * MIN))
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.recipient_user_id).sort()).toEqual(["client-1", "client-2"])
  })

  it("ignores a message whose conversation is missing", () => {
    expect(messagesNeedingEmail(input([message({ conversation_id: "gone" })], [conversation()], 6 * MIN))).toEqual([])
  })
})
