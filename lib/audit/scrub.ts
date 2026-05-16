const REDACT_KEY_PATTERN = /(^|_)(password|password_hash|token|secret|api_key)($|_)/i
const MAX_SERIALIZED_BYTES = 8 * 1024
const SAMPLE_BYTES = 1024

function redactRecursive(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactRecursive)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEY_PATTERN.test(k)) {
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

  const redacted = redactRecursive(input) as Record<string, unknown>
  let serialized: string
  try {
    serialized = JSON.stringify(redacted)
  } catch {
    return { truncated: true, sample: "[unserializable]" }
  }
  if (serialized.length <= MAX_SERIALIZED_BYTES) return redacted
  return { truncated: true, sample: serialized.slice(0, SAMPLE_BYTES) }
}
