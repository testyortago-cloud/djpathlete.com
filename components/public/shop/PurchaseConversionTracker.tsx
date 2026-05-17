"use client"

import { useEffect, useRef } from "react"
import { fireRotationalRebootPurchase, fireConversion, CONVERSION_SEND_TO } from "@/lib/google-ads-tag"

interface PurchaseConversionTrackerProps {
  orderNumber: string
  totalCents: number
  /**
   * Product names in this order (ShopOrderItem.name). If any name contains
   * "rotational reboot" (case-insensitive), fire the Rotational Reboot
   * purchase action specifically. Otherwise fire a generic purchase event
   * — currently routed to the same action since RR is our only PURCHASE
   * conversion. When we add a generic Shop Purchase action we'll branch
   * the routing here.
   */
  productNames: string[]
}

function isRotationalReboot(productName: string): boolean {
  return /rotational[\s_-]+reboot/i.test(productName)
}

/**
 * Fires exactly once per mount (StrictMode guarded) when the user lands on
 * the thank-you page. transaction_id = order_number so Google dedupes if a
 * user reloads. Server-side reconciliation handles the actual order state;
 * this is purely the conversion-tracking ping.
 */
export function PurchaseConversionTracker({
  orderNumber,
  totalCents,
  productNames,
}: PurchaseConversionTrackerProps) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    const valueUsd = totalCents / 100
    if (productNames.some(isRotationalReboot)) {
      fireRotationalRebootPurchase({ value_usd: valueUsd, order_number: orderNumber })
    } else {
      // Generic purchase — still routes to the Rotational Reboot action
      // since it's our only PURCHASE action today. When we add a generic
      // "Shop Purchase" action we'll branch here.
      fireConversion({
        send_to: CONVERSION_SEND_TO.purchase_rotational_reboot,
        value: valueUsd,
        currency: "USD",
        transaction_id: orderNumber,
      })
    }
  }, [orderNumber, totalCents, productNames])

  return null
}
