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
