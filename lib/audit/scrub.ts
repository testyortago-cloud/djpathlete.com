// Match if the key, normalized to lowercase, contains any of the
// sensitive tokens as a "word" — either at start/end or bounded by
// _ or -. Examples that should match:
//   password, PASSWORD, password_hash, Password_Hash,
//   accessToken, refreshToken, bearerToken, apiKey, apiSecret, X-Api-Key.
// Examples that should NOT match:
//   email, username, normal, innocent, mypassword (no boundary).
const REDACT_KEY_PATTERN = /(?:^|[_-])(password|token|secret|api_key)(?:$|[_-])/i
const MAX_SERIALIZED_BYTES = 8 * 1024
const SAMPLE_BYTES = 1024

function isSensitiveKey(key: string): boolean {
  // Insert _ at every camelCase boundary, lowercase, then test.
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  return REDACT_KEY_PATTERN.test(normalized)
}

function redactRecursive(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactRecursive)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = "[REDACTED]"
    } else {
      out[k] = redactRecursive(v)
    }
  }
  return out
}

export function scrubMetadata(input: unknown): Record<string, unknown> {
  if (input == null) return {}
  if (typeof input !== "object") return {}

  let redacted: Record<string, unknown>
  try {
    redacted = redactRecursive(input) as Record<string, unknown>
  } catch {
    return { truncated: true, sample: "[unserializable]" }
  }
  let serialized: string
  try {
    serialized = JSON.stringify(redacted)
  } catch {
    return { truncated: true, sample: "[unserializable]" }
  }
  if (serialized.length <= MAX_SERIALIZED_BYTES) return redacted
  return { truncated: true, sample: serialized.slice(0, SAMPLE_BYTES) }
}
