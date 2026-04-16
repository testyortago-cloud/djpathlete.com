import { z } from "zod"

const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid UUID"
)

export const shippingAddressSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(30).nullable(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  country: z.string().length(2, "Country must be ISO 2-letter code"),
  postal_code: z.string().min(1).max(20),
})
export type ShippingAddress = z.infer<typeof shippingAddressSchema>

export const cartItemSchema = z.object({
  variant_id: uuid,
  quantity: z.number().int().min(1).max(99),
})
export type CartItem = z.infer<typeof cartItemSchema>

export const shippingQuoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  address: shippingAddressSchema,
})
export type ShippingQuoteRequest = z.infer<typeof shippingQuoteRequestSchema>

export const checkoutRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  address: shippingAddressSchema,
  shipping_cents: z.number().int().min(0).max(100_000),
})
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export const orderLookupSchema = z.object({
  email: z.string().email(),
})
export type OrderLookupRequest = z.infer<typeof orderLookupSchema>

export const adminUpdateProductSchema = z.object({
  description: z.string().max(5000).optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().min(-1000).max(1000).optional(),
  thumbnail_url_override: z.string().url().nullable().optional(),
})
export type AdminUpdateProduct = z.infer<typeof adminUpdateProductSchema>

export const adminUpdateVariantSchema = z.object({
  mockup_url_override: z.string().url().nullable().optional(),
})
export type AdminUpdateVariant = z.infer<typeof adminUpdateVariantSchema>

export const adminRefundSchema = z.object({
  amount_cents: z.number().int().min(1).max(10_000_000),
  reason: z.string().max(500).optional(),
})
export type AdminRefund = z.infer<typeof adminRefundSchema>
