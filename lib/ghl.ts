/**
 * GoHighLevel (GHL) API v2 Client
 *
 * Provides functions for managing contacts, triggering workflows,
 * and sending webhooks through the GHL platform. All public functions
 * gracefully degrade when GHL is not configured.
 */

import { withRetry } from "@/lib/utils/with-retry"

const GHL_BASE_URL = "https://services.leadconnectorhq.com"

const GHL_API_KEY = process.env.GHL_API_KEY ?? ""
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID ?? ""

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GHLContactData {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  tags?: string[]
  source?: string
}

export interface GHLWebhookData {
  type: string
  [key: string]: unknown
}

interface GHLContact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  tags?: string[]
  [key: string]: unknown
}

interface GHLUpsertResponse {
  contact: GHLContact
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

/**
 * Returns true when both GHL_API_KEY and GHL_LOCATION_ID are set.
 */
export function isGHLConfigured(): boolean {
  return GHL_API_KEY.length > 0 && GHL_LOCATION_ID.length > 0
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Low-level fetch wrapper that prepends the GHL base URL and injects
 * authorization / version headers required by the GHL API v2.
 */
async function ghlFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${GHL_BASE_URL}${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
      ...(options.headers as Record<string, string> | undefined),
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown")
    throw new Error(`GHL API error ${response.status} on ${path}: ${body}`)
  }

  return response
}

// ---------------------------------------------------------------------------
// Core API functions (may throw)
// ---------------------------------------------------------------------------

/**
 * Creates or updates a contact in GHL via the upsert endpoint.
 */
async function createOrUpdateContact(data: GHLContactData): Promise<GHLContact | null> {
  const response = await ghlFetch("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      locationId: GHL_LOCATION_ID,
      tags: data.tags,
      source: data.source,
    }),
  })

  const json = (await response.json()) as GHLUpsertResponse
  return json.contact ?? null
}

/**
 * Adds a contact to a specific workflow.
 */
async function addContactToWorkflow(contactId: string, workflowId: string): Promise<boolean> {
  await ghlFetch(`/contacts/${contactId}/workflow/${workflowId}`, {
    method: "POST",
  })

  return true
}

/**
 * Fires a webhook with an arbitrary JSON payload.
 * Posts directly to the given URL rather than through the GHL API base.
 */
async function triggerWebhook(webhookUrl: string, data: GHLWebhookData): Promise<boolean> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown")
    throw new Error(`Webhook error ${response.status} on ${webhookUrl}: ${body}`)
  }

  return true
}

/**
 * Looks up a contact by email address.
 */
async function findContactByEmail(email: string): Promise<GHLContact | null> {
  const response = await ghlFetch(`/contacts/lookup?email=${encodeURIComponent(email)}&locationId=${GHL_LOCATION_ID}`, {
    method: "GET",
  })

  const json = (await response.json()) as { contacts?: GHLContact[] }
  return json.contacts?.[0] ?? null
}

/**
 * Deletes a contact by ID.
 */
async function deleteContactById(contactId: string): Promise<boolean> {
  await ghlFetch(`/contacts/${contactId}`, { method: "DELETE" })
  return true
}

/**
 * Fetches all contacts from GHL, paginating through results.
 * Optionally filters by a tag (e.g. "newsletter").
 */
async function fetchAllContacts(tag?: string): Promise<GHLContact[]> {
  const contacts: GHLContact[] = []
  let nextPageUrl: string | null =
    `/contacts/?locationId=${GHL_LOCATION_ID}&limit=100` + (tag ? `&query=${encodeURIComponent(tag)}` : "")

  while (nextPageUrl) {
    const response = await ghlFetch(nextPageUrl, { method: "GET" })
    const json = (await response.json()) as {
      contacts?: GHLContact[]
      meta?: { nextPageUrl?: string; total?: number }
    }

    if (json.contacts) {
      contacts.push(...json.contacts)
    }

    // GHL returns a full URL for nextPageUrl — extract the path
    const rawNext = json.meta?.nextPageUrl
    if (rawNext) {
      try {
        const url = new URL(rawNext)
        nextPageUrl = url.pathname + url.search
      } catch {
        nextPageUrl = null
      }
    } else {
      nextPageUrl = null
    }
  }

  return contacts
}

// ---------------------------------------------------------------------------
// Public API (never throw — graceful degradation)
// ---------------------------------------------------------------------------

/**
 * Creates or updates a GHL contact with automatic retry.
 * Returns the contact object on success, or null on any failure.
 */
export async function ghlCreateContact(data: GHLContactData): Promise<GHLContact | null> {
  if (!isGHLConfigured()) {
    console.warn("[GHL] Not configured — skipping createContact")
    return null
  }

  try {
    return await withRetry(() => createOrUpdateContact(data))
  } catch (error) {
    console.error("[GHL] Failed to create/update contact:", error)
    return null
  }
}

/**
 * Triggers a GHL workflow for a contact with automatic retry.
 * Returns true on success, false on any failure.
 */
export async function ghlTriggerWorkflow(contactId: string, workflowId: string): Promise<boolean> {
  if (!isGHLConfigured()) {
    console.warn("[GHL] Not configured — skipping triggerWorkflow")
    return false
  }

  try {
    return await withRetry(() => addContactToWorkflow(contactId, workflowId))
  } catch (error) {
    console.error("[GHL] Failed to trigger workflow:", error)
    return false
  }
}

/**
 * Sends a webhook payload to the given URL with automatic retry.
 * Returns true on success, false on any failure.
 */
export async function ghlTriggerWebhook(webhookUrl: string, data: GHLWebhookData): Promise<boolean> {
  try {
    return await withRetry(() => triggerWebhook(webhookUrl, data))
  } catch (error) {
    console.error("[GHL] Failed to trigger webhook:", error)
    return false
  }
}

/**
 * Deletes a GHL contact by looking up their email address first.
 * Returns true on success, false on any failure or if contact not found.
 */
/**
 * Fetches all contacts from GHL and returns their email addresses.
 * Returns an empty array on any failure.
 */
export async function ghlGetAllContacts(): Promise<
  { email: string; firstName?: string; lastName?: string; tags?: string[] }[]
> {
  if (!isGHLConfigured()) {
    console.warn("[GHL] Not configured — skipping getAllContacts")
    return []
  }

  try {
    const contacts = await fetchAllContacts()
    return contacts
      .filter((c) => c.email)
      .map((c) => ({
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        tags: c.tags,
      }))
  } catch (error) {
    console.error("[GHL] Failed to fetch all contacts:", error)
    return []
  }
}

export async function ghlDeleteContact(email: string): Promise<boolean> {
  if (!isGHLConfigured()) {
    console.warn("[GHL] Not configured — skipping deleteContact")
    return false
  }

  try {
    const contact = await withRetry(() => findContactByEmail(email))
    if (!contact?.id) {
      console.warn(`[GHL] No contact found for ${email} — skipping delete`)
      return false
    }

    return await withRetry(() => deleteContactById(contact.id))
  } catch (error) {
    console.error("[GHL] Failed to delete contact:", error)
    return false
  }
}
