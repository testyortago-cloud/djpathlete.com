import { describe, it, expect, vi, beforeEach } from "vitest"

const rpcMock = vi.fn()
const fromMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: fromMock,
    rpc: rpcMock,
  }),
}))

vi.mock("@/lib/firebase-admin", () => ({
  getSignedVideoUrl: vi.fn(async (path: string) => `https://signed.example/${path}?token=x`),
}))

import { createFormReviewMessageWithAudio, getFormReviewMessages } from "@/lib/db/form-reviews"

describe("createFormReviewMessageWithAudio", () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it("calls the RPC and returns the joined message+attachment shape", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          message_id: "msg-1",
          attachment_id: "att-1",
          created_at: "2026-05-19T00:00:00Z",
        },
      ],
      error: null,
    })

    const result = await createFormReviewMessageWithAudio({
      review_id: "r-1",
      user_id: "u-1",
      kind: "audio",
      storage_path: "form-review-audio/u-1/x.webm",
      mime_type: "audio/webm",
      duration_seconds: 12,
      byte_size: 100_000,
    })

    expect(rpcMock).toHaveBeenCalledWith("create_form_review_message_with_attachment", {
      p_review_id: "r-1",
      p_user_id: "u-1",
      p_kind: "audio",
      p_storage_path: "form-review-audio/u-1/x.webm",
      p_mime_type: "audio/webm",
      p_duration_seconds: 12,
      p_byte_size: 100_000,
    })
    expect(result.id).toBe("msg-1")
    expect(result.message).toBeNull()
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments?.[0].storage_path).toBe("form-review-audio/u-1/x.webm")
  })

  it("throws when the RPC returns an error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(
      createFormReviewMessageWithAudio({
        review_id: "r-1",
        user_id: "u-1",
        kind: "audio",
        storage_path: "form-review-audio/u-1/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 12,
        byte_size: 100,
      }),
    ).rejects.toThrow(/boom/)
  })
})

describe("getFormReviewMessages signs audio URLs", () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it("adds a playback_url to each audio attachment", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "m-1",
            form_review_id: "r-1",
            user_id: "u-1",
            message: null,
            created_at: "2026-05-19T00:00:00Z",
            form_review_message_attachments: [
              {
                id: "a-1",
                message_id: "m-1",
                kind: "audio",
                storage_path: "form-review-audio/u-1/x.webm",
                mime_type: "audio/webm",
                duration_seconds: 14,
                byte_size: 100,
                created_at: "2026-05-19T00:00:00Z",
              },
            ],
            users: { first_name: "A", last_name: "B", avatar_url: null, role: "admin" },
          },
        ],
        error: null,
      }),
    }
    fromMock.mockReturnValue(builder)

    const rows = await getFormReviewMessages("r-1")
    expect(rows[0].attachments).toHaveLength(1)
    expect(rows[0].attachments?.[0]).toMatchObject({
      storage_path: "form-review-audio/u-1/x.webm",
      playback_url: expect.stringContaining("https://signed.example/"),
    })
  })
})
