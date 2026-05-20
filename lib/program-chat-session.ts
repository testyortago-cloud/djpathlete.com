// Stable session-id persistence for the AI Program Builder chat.
//
// The program-chat Firebase function keeps the real conversation (with
// tool_use / tool_result blocks) in a Firestore `ai_chat_state/{sessionId}`
// document and resumes from it each turn. The frontend's only job for
// continuity is to send the SAME sessionId on every turn of a conversation.
//
// Previously the id lived in a `useRef` initialised from the full chat-state
// blob in localStorage. If that blob was missing (page reload before the
// save effect fired, expiry, parse error) a brand-new id was minted — the
// backend then could not resume, treated the turn as turn 1, and the agent
// re-ran every lookup tool. That is the "looping / hallucinating" bug.
//
// Persisting the id under its own key, written the moment it is created,
// decouples it from the chat-state blob and makes it survive remounts.

const SESSION_ID_KEY = "djp-program-chat-session-id"

function freshSessionId(): string {
  return `program-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Returns the persisted program-chat session id, creating and persisting a
 * fresh one if none exists. Stable across component remounts and page reloads.
 * Falls back to an ephemeral id if localStorage is unavailable (SSR, private
 * mode) — continuity is best-effort in that case but never throws.
 */
export function getOrCreateProgramChatSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY)
    if (existing) return existing
    const id = freshSessionId()
    localStorage.setItem(SESSION_ID_KEY, id)
    return id
  } catch {
    return freshSessionId()
  }
}

/**
 * Discards the current session id and persists a fresh one. Use when the
 * operator starts a New Chat so the next conversation gets its own backend
 * ai_chat_state document.
 */
export function resetProgramChatSessionId(): string {
  const id = freshSessionId()
  try {
    localStorage.setItem(SESSION_ID_KEY, id)
  } catch {
    // localStorage unavailable — the caller still gets a usable fresh id.
  }
  return id
}
