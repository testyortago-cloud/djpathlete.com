import { createElement, type ReactElement } from "react"
import { resend, FROM_EMAIL } from "@/lib/resend"
import type { ShopOrder } from "@/types/database"
import { OrderReceivedEmail } from "@/lib/shop/emails/order-received"
import { OrderConfirmedEmail } from "@/lib/shop/emails/order-confirmed"
import { OrderShippedEmail } from "@/lib/shop/emails/order-shipped"
import { OrderCanceledEmail } from "@/lib/shop/emails/order-canceled"
import { OrderRefundedEmail } from "@/lib/shop/emails/order-refunded"

// Dynamically imported to avoid Turbopack's app-route static check for
// `react-dom/server` imports. Only ever runs server-side from route handlers.
async function renderEmail(element: ReactElement): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server")
  return renderToStaticMarkup(element)
}

function lookupUrl(order: ShopOrder): string {
  const base =
    process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  return `${base}/shop/orders/${order.order_number}`
}

function hasApiKey(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

function warnMissingKey(fn: string) {
  console.warn(`[shop/emails] RESEND_API_KEY not set — skipping ${fn}`)
}

export async function sendOrderReceivedEmail(order: ShopOrder): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendOrderReceivedEmail")
    return
  }

  const url = lookupUrl(order)
  const html = await renderEmail(
    createElement(OrderReceivedEmail, { order, lookupUrl: url }),
  )

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: order.customer_email,
    subject: `Order received: ${order.order_number} — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("[shop/emails] Failed to send order-received email:", error)
  }
}

export async function sendOrderConfirmedEmail(order: ShopOrder): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendOrderConfirmedEmail")
    return
  }

  const url = lookupUrl(order)
  const html = await renderEmail(
    createElement(OrderConfirmedEmail, { order, lookupUrl: url }),
  )

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: order.customer_email,
    subject: `Your order is in production: ${order.order_number} — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("[shop/emails] Failed to send order-confirmed email:", error)
  }
}

export async function sendOrderShippedEmail(order: ShopOrder): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendOrderShippedEmail")
    return
  }

  const url = lookupUrl(order)
  const html = await renderEmail(
    createElement(OrderShippedEmail, { order, lookupUrl: url }),
  )

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: order.customer_email,
    subject: `Your order has shipped: ${order.order_number} — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("[shop/emails] Failed to send order-shipped email:", error)
  }
}

export async function sendOrderCanceledEmail(order: ShopOrder): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendOrderCanceledEmail")
    return
  }

  const url = lookupUrl(order)
  const html = await renderEmail(
    createElement(OrderCanceledEmail, { order, lookupUrl: url }),
  )

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: order.customer_email,
    subject: `Your order has been canceled: ${order.order_number} — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("[shop/emails] Failed to send order-canceled email:", error)
  }
}

export async function sendOrderRefundedEmail(order: ShopOrder): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendOrderRefundedEmail")
    return
  }

  const url = lookupUrl(order)
  const html = await renderEmail(
    createElement(OrderRefundedEmail, { order, lookupUrl: url }),
  )

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: order.customer_email,
    subject: `Refund processed for order ${order.order_number} — DJP Athlete`,
    html,
  })

  if (error) {
    console.error("[shop/emails] Failed to send order-refunded email:", error)
  }
}

export async function sendDigitalFulfillmentEmail(input: {
  to: string
  orderNumber: string
}): Promise<void> {
  if (!hasApiKey()) {
    warnMissingKey("sendDigitalFulfillmentEmail")
    return
  }
  const base = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3050"
  await resend.emails.send({
    from: FROM_EMAIL,
    to: input.to,
    subject: `Your download is ready — order ${input.orderNumber}`,
    html: `<h1>Your download is ready</h1><p>You can access your files any time at:</p><p><a href="${base}/shop/orders/${input.orderNumber}/downloads">View downloads</a></p>`,
  })
}

/**
 * The download links a visitor was promised in exchange for their address.
 *
 * FAILS LOUD, unlike the order notifications above, because this email IS the
 * thing the visitor asked for: a swallowed failure here means they are shown
 * "check your inbox" for a message that will never arrive. Its only caller,
 * app/api/shop/leads/route.ts, catches and answers 502, so the visitor is told.
 * The order emails are notifications ABOUT an order that already exists, where
 * a logged failure and a standing order is the right trade.
 *
 * The no-key throw is honest but, today, only reachable in tests: `lib/resend
 * .ts` builds its client eagerly (`new Resend(process.env.RESEND_API_KEY!)`)
 * and the SDK's constructor throws when the key is unset, so in a real process
 * importing this module already fails first. Production has the key, so the
 * live half of this function's error reporting is the send-result check below.
 */
export async function sendFreeDownloadEmail(input: {
  to: string
  productName: string
  files: import("@/types/database").ShopProductFile[]
  ttlSeconds: number
}) {
  if (!hasApiKey()) {
    throw new Error("RESEND_API_KEY is not set — the download email cannot be sent")
  }
  const { generateSignedDownloadUrl } = await import("@/lib/shop/downloads")
  const urls = await Promise.all(
    input.files.map(async (f) => ({
      name: f.display_name,
      url: await generateSignedDownloadUrl(f.storage_path, input.ttlSeconds),
    })),
  )
  const ttlMinutes = Math.round(input.ttlSeconds / 60)
  const linksHtml = urls
    .map((u) => `<li><a href="${u.url}">${u.name}</a></li>`)
    .join("")
  const html = `
    <h1>Your free download</h1>
    <p>Thanks for subscribing. Here's your download for <strong>${input.productName}</strong>:</p>
    <ul>${linksHtml}</ul>
    <p>Links expire in ${ttlMinutes} minutes. Re-submit the form on the product page if you need fresh links.</p>
  `
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: input.to,
    subject: `Your free download — ${input.productName}`,
    html,
  })

  if (error) {
    throw new Error(`free download email failed: ${error.message}`)
  }
}
