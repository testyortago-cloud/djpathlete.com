import { createHmac, timingSafeEqual } from "node:crypto"

const BASE = "https://api.printful.com"

export class PrintfulError extends Error {
  status: number
  code?: number | string
  constructor(status: number, message: string, code?: number | string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function headers(): Record<string, string> {
  const key = process.env.PRINTFUL_API_KEY
  if (!key) throw new Error("PRINTFUL_API_KEY not set")
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  if (process.env.PRINTFUL_STORE_ID) h["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID
  return h
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message ?? (typeof body?.result === "string" ? body.result : `Printful ${res.status}`)
    throw new PrintfulError(res.status, msg, body?.code)
  }
  return body.result as T
}

export interface SyncProductSummary {
  id: number
  external_id: string
  name: string
  variants: number
  synced: number
  thumbnail_url: string
}

export interface SyncVariant {
  id: number
  external_id: string
  sync_product_id: number
  name: string
  variant_id: number
  retail_price: string
  currency: string
  sku: string
  product: { image: string; name: string }
  files: Array<{ type: string; preview_url: string }>
  options: Array<{ id: string; value: string }>
  is_ignored: boolean
}

export interface SyncProductDetail {
  sync_product: SyncProductSummary
  sync_variants: SyncVariant[]
}

export interface ShippingRate {
  id: string
  name: string
  rate: string
  currency: string
  min_delivery_days?: number
  max_delivery_days?: number
}

export interface PrintfulRecipient {
  name: string
  address1: string
  address2?: string | null
  city: string
  state_code: string
  country_code: string
  zip: string
  phone?: string | null
  email: string
}

export interface PrintfulOrderItemInput {
  sync_variant_id?: number
  variant_id?: number
  quantity: number
  retail_price?: string
}

export interface PrintfulOrder {
  id: number
  external_id: string
  status: string
  shipping: string
  recipient: PrintfulRecipient
  items: Array<{
    id: number
    sync_variant_id?: number
    variant_id: number
    quantity: number
    name: string
  }>
  retail_costs: { subtotal: string; shipping: string; total: string; currency: string }
}

export async function listSyncProducts(): Promise<SyncProductSummary[]> {
  return request<SyncProductSummary[]>("/store/products")
}

export async function getSyncProduct(id: number): Promise<SyncProductDetail> {
  return request<SyncProductDetail>(`/store/products/${id}`)
}

export async function getShippingRates(opts: {
  recipient: PrintfulRecipient
  items: Array<{ variant_id?: number; sync_variant_id?: number; quantity: number }>
}): Promise<ShippingRate[]> {
  return request<ShippingRate[]>("/shipping/rates", {
    method: "POST",
    body: JSON.stringify({ recipient: opts.recipient, items: opts.items }),
  })
}

export async function createOrder(opts: {
  external_id: string
  recipient: PrintfulRecipient
  items: PrintfulOrderItemInput[]
  retail_costs?: { currency?: string; subtotal?: string; shipping?: string; total?: string }
  shipping?: string
}): Promise<PrintfulOrder> {
  return request<PrintfulOrder>("/orders?confirm=false", {
    method: "POST",
    body: JSON.stringify(opts),
  })
}

export async function confirmOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}/confirm`, { method: "POST" })
}

export async function cancelOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}`, { method: "DELETE" })
}

export async function getOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}`)
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET
  if (!secret) throw new Error("PRINTFUL_WEBHOOK_SECRET not set")
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}
