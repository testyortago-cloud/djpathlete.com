/** Shared configuration for the admin AI chatbot. */

/** Max tokens for Anthropic response */
export const AI_CHAT_MAX_TOKENS = 1024

/** Max messages per conversation accepted by the validator */
export const AI_CHAT_MAX_MESSAGES = 50

/** Max recent messages actually sent to the model (saves input tokens) */
export const AI_CHAT_API_MESSAGE_LIMIT = 10

/** Max characters per message */
export const AI_CHAT_MAX_MESSAGE_LENGTH = 5000

/** Timeout for building platform context (ms) */
export const AI_CHAT_CONTEXT_TIMEOUT_MS = 10_000

/** Rate limit: max requests per window */
export const AI_CHAT_RATE_LIMIT_MAX = 10

/** Rate limit: window duration (ms) */
export const AI_CHAT_RATE_LIMIT_WINDOW_MS = 60_000

/** Max retries for Anthropic API calls */
export const AI_CHAT_RETRY_ATTEMPTS = 2

/** Max messages stored in localStorage */
export const AI_CHAT_HISTORY_LIMIT = 50

/** localStorage key for conversations */
export const AI_CHAT_STORAGE_KEY = "djp-admin-chat-conversations"

/** Max conversations to keep in localStorage */
export const AI_CHAT_MAX_CONVERSATIONS = 30
