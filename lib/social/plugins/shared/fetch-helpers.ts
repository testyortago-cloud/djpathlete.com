// lib/social/plugins/shared/fetch-helpers.ts
// Small fetch utilities shared across all 6 platform plugins. Keeps each
// plugin file focused on its own API contract rather than HTTP plumbing.

export interface FetchJsonOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  body?: unknown
  headers?: Record<string, string>
}

export interface FetchJsonResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  errorText: string | null
}

/**
 * Wrapper around fetch() that always returns a discriminated result object
 * instead of throwing. Plugin code can check .ok and return a typed
 * PublishResult without try/catch scaffolding everywhere.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<FetchJsonResult<T>> {
  const method = options.method ?? "GET"
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {}),
  }

  const body =
    options.body === undefined
      ? undefined
      : options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)

  const response = await fetch(url, { method, headers, body })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    return { ok: false, status: response.status, data: null, errorText }
  }

  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : null
  return { ok: true, status: response.status, data, errorText: null }
}

/**
 * Builds a URLSearchParams string from a plain object, skipping undefined
 * values. Used by every plugin for their query-string APIs.
 */
export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const filtered = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number | boolean][]
  if (filtered.length === 0) return ""
  const qs = new URLSearchParams()
  for (const [k, v] of filtered) qs.set(k, String(v))
  return `?${qs.toString()}`
}
