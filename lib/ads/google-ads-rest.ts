// lib/ads/google-ads-rest.ts
// REST replacement for `customer.mutateResources()` from the `google-ads-api`
// SDK. The SDK is gRPC-based and crashes on Vercel with "Channel credentials
// must be a ChannelCredentials object" because Webpack-bundled lambdas ship
// duplicated copies of `@grpc/grpc-js`, breaking an internal instanceof check.
// REST has none of that machinery.
//
// We accept the same MutationOperation shape our builders already produce
// (entity, operation, resource, ...fields with snake_case keys) and translate
// it into the REST `googleAds:mutate` envelope:
//   {
//     mutateOperations: [
//       { <entityOperation>: { <opType>: { resourceName, ...camelCaseFields } } },
//       ...
//     ]
//   }
//
// Endpoint:
//   POST https://googleads.googleapis.com/v21/customers/{customer_id}/googleAds:mutate

import { getPlatformConnection } from "@/lib/db/platform-connections"
import type { MutationOperation } from "./new-campaign-mutation"

const GOOGLE_ADS_API_VERSION = "v21"

/**
 * snake_case → camelCase. Numbers and existing camelCase pass through.
 * Walks the value recursively (objects + arrays). Top-level "resource" gets
 * special-cased to "resourceName" by the caller — this helper just handles
 * key renaming.
 */
function snakeToCamel(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(snakeToCamel)
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      const camel = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      out[camel] = snakeToCamel(v)
    }
    return out
  }
  return input
}

/**
 * Maps our snake_case `entity` field (e.g. "campaign_budget") to the REST
 * envelope key ("campaignBudgetOperation"). Adding a new entity type to
 * any builder requires adding a row here.
 */
const ENTITY_TO_OPERATION_KEY: Record<string, string> = {
  campaign_budget: "campaignBudgetOperation",
  campaign: "campaignOperation",
  campaign_criterion: "campaignCriterionOperation",
  ad_group: "adGroupOperation",
  ad_group_criterion: "adGroupCriterionOperation",
  ad_group_ad: "adGroupAdOperation",
}

function entityOperationKey(entity: string): string {
  const key = ENTITY_TO_OPERATION_KEY[entity]
  if (!key) throw new Error(`Unknown entity for REST mutate: ${entity}`)
  return key
}

interface RestMutateBody {
  mutateOperations: Array<Record<string, unknown>>
  partialFailure?: boolean
}

function toRestEnvelope(ops: MutationOperation[]): RestMutateBody {
  const mutateOperations = ops.map((op) => {
    const {
      entity,
      operation,
      resource,
      policy_validation_parameter,
      update_mask,
      ...fields
    } = op
    // Convert field keys to camelCase. resourceName is only included when the
    // caller actually set a temp/real resource name — leaf ops (criteria,
    // keywords, RSAs) omit it because composite temp IDs like
    // `campaignCriteria/-2~-3` trigger INCONSISTENT_FIELD_VALUES on REST.
    const camelFields = snakeToCamel(fields) as Record<string, unknown>
    const body: Record<string, unknown> = resource
      ? { resourceName: resource, ...camelFields }
      : { ...camelFields }
    const envelope: Record<string, unknown> = {
      [operation]: body,
    }
    // policy_validation_parameter is a sibling of `create`/`update`, NOT
    // nested inside the entity body. Only ad_group_ad / ad_group_criterion
    // ops actually accept ignorable_policy_topics.
    if (policy_validation_parameter) {
      envelope.policyValidationParameter = snakeToCamel(policy_validation_parameter)
    }
    // update_mask is required for `update` operations — it's a comma-
    // separated list of field paths and lives as `updateMask` on the
    // envelope (sibling of `update`).
    if (operation === "update" && update_mask) {
      envelope.updateMask = update_mask
    }
    return {
      [entityOperationKey(entity)]: envelope,
    }
  })
  return { mutateOperations }
}

async function refreshAccessToken(refresh_token: string): Promise<string> {
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!client_id || !client_secret) {
    throw new Error("Google Ads OAuth client env vars missing")
  }
  const params = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: "refresh_token",
  })
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth refresh failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("OAuth refresh: missing access_token")
  return json.access_token
}

export interface RestMutateResult {
  /** Raw JSON response from the API. */
  response: unknown
  /** Resource name of the first campaign created in this batch, if any. */
  createdCampaignResource: string | null
}

/**
 * Atomic multi-resource mutate via REST. Throws on non-2xx with the API's
 * error body included in the message (truncated) so the apply path can
 * record it in automation_log.
 */
export interface MutateResourcesOptions {
  /**
   * Per Google Ads REST docs: when true, individual op failures (e.g. a
   * keyword that violates a policy topic that can't be ignored at the
   * keyword level) don't abort the whole batch. Successful ops still apply,
   * failures surface in `partialFailureError`. Use for new_campaign creates
   * so a single bad keyword doesn't kill an otherwise-good campaign.
   */
  partialFailure?: boolean
}

export async function mutateResourcesRest(
  customerId: string,
  ops: MutationOperation[],
  options: MutateResourcesOptions = {},
): Promise<RestMutateResult> {
  if (ops.length === 0) {
    return { response: { mutateOperationResponses: [] }, createdCampaignResource: null }
  }
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developer_token) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN missing")
  }
  const conn = await getPlatformConnection("google_ads")
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (!refresh_token) {
    throw new Error("Google Ads not connected (no refresh_token in platform_connections)")
  }
  const access_token = await refreshAccessToken(refresh_token)

  const body = toRestEnvelope(ops)
  if (options.partialFailure) body.partialFailure = true
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:mutate`
  const headers: Record<string, string> = {
    authorization: `Bearer ${access_token}`,
    "developer-token": developer_token,
    "content-type": "application/json",
  }
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `googleAds:mutate failed (HTTP ${res.status}): ${text.slice(0, 3000)}`,
    )
  }
  const response = JSON.parse(text) as {
    mutateOperationResponses?: Array<Record<string, { resourceName?: string }>>
  }

  // Find the campaign creation result so the caller can log it.
  let createdCampaignResource: string | null = null
  for (const item of response.mutateOperationResponses ?? []) {
    const campaignResult = item.campaignResult
    if (campaignResult?.resourceName) {
      createdCampaignResource = campaignResult.resourceName
      break
    }
  }

  return { response, createdCampaignResource }
}

/**
 * Runs a GAQL query against `customers/{customer_id}/googleAds:search` and
 * returns the parsed `results` array (or an empty array). Same REST + fetch
 * approach as mutateResourcesRest — bypasses the gRPC SDK so it works on
 * Vercel. Throws on non-2xx with the API error body included.
 */
export async function searchGoogleAdsRest(
  customerId: string,
  gaql: string,
  options: { loginCustomerIdOverride?: string | null } = {},
): Promise<unknown[]> {
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!developer_token) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN missing")
  }
  const conn = await getPlatformConnection("google_ads")
  const refresh_token = conn?.credentials?.refresh_token as string | undefined
  if (!refresh_token) {
    throw new Error("Google Ads not connected (no refresh_token in platform_connections)")
  }
  const access_token = await refreshAccessToken(refresh_token)

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`
  const headers: Record<string, string> = {
    authorization: `Bearer ${access_token}`,
    "developer-token": developer_token,
    "content-type": "application/json",
  }
  const loginCustomerId =
    options.loginCustomerIdOverride !== undefined
      ? options.loginCustomerIdOverride
      : process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: gaql }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`googleAds:search failed (HTTP ${res.status}): ${text.slice(0, 3000)}`)
  }
  const parsed = JSON.parse(text) as { results?: unknown[] }
  return parsed.results ?? []
}
