"use server"

// app/(admin)/admin/actions.ts — the cookie-setting server action behind
// components/admin/BusinessSwitcher.tsx.

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { BUSINESS_COOKIE, businessCookieOptions } from "@/lib/tenancy/cookie"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"

export async function selectBusiness(businessId: string) {
  // Validated against the caller's OWN allowed set before it is written, so a
  // forged action argument cannot park an unreachable id in the cookie. The
  // resolver would ignore it anyway; refusing here keeps the cookie honest.
  const { choices, isOperator } = await resolveAdminTenant()
  if (!isOperator && !choices.some((c) => c.id === businessId)) return
  const jar = await cookies()
  jar.set(BUSINESS_COOKIE, businessId, businessCookieOptions)
  revalidatePath("/admin")
}
