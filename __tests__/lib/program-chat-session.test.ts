// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import {
  getOrCreateProgramChatSessionId,
  resetProgramChatSessionId,
} from "@/lib/program-chat-session"

const KEY = "djp-program-chat-session-id"

describe("program-chat session id persistence", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("creates a new session id and persists it when none exists", () => {
    expect(localStorage.getItem(KEY)).toBeNull()

    const id = getOrCreateProgramChatSessionId()

    expect(id).toMatch(/^program-chat-/)
    expect(localStorage.getItem(KEY)).toBe(id)
  })

  // Regression: the AI program builder looped because a remount minted a
  // fresh session id, so the backend could not resume ai_chat_state and the
  // agent re-ran every tool from scratch. The id must survive across calls.
  it("returns the same id across repeated calls (stable across remounts)", () => {
    const first = getOrCreateProgramChatSessionId()
    const second = getOrCreateProgramChatSessionId()

    expect(second).toBe(first)
  })

  it("reuses an id that is already persisted in localStorage", () => {
    localStorage.setItem(KEY, "program-chat-existing-123")

    expect(getOrCreateProgramChatSessionId()).toBe("program-chat-existing-123")
  })

  it("resetProgramChatSessionId mints a different persisted id", () => {
    const original = getOrCreateProgramChatSessionId()

    const reset = resetProgramChatSessionId()

    expect(reset).not.toBe(original)
    expect(reset).toMatch(/^program-chat-/)
    // The fresh id is now the persisted one.
    expect(getOrCreateProgramChatSessionId()).toBe(reset)
  })
})
