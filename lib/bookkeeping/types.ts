import type {
  LedgerDirection, LedgerSource, Payment, ShopOrder, EventSignup,
  ClientPackage, ClientMembership,
} from "@/types/database"

export interface LedgerEntryDraft {
  direction: LedgerDirection
  amount_cents: number
  occurred_on: string
  memo: string
  counterparty: string | null
  service_line: string | null
  source: LedgerSource
  source_ref: string
}

export interface IncomeSourceRows {
  payments: Payment[]
  shopOrders: ShopOrder[]
  clientPackages: Array<ClientPackage & { product_name?: string | null }>
  eventSignups: Array<EventSignup & { event_title?: string | null; event_type?: string | null }>
  memberships: Array<ClientMembership & { plan_name?: string | null; plan_price_cents?: number | null; plan_interval?: string | null }>
}

export interface IncomeAdapterResult {
  drafts: LedgerEntryDraft[]
  warnings: string[]
}
