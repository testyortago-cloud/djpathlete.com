// Pure helpers for the receipts subsystem (Phase 3). Zero IO.

export function accountRequiresBusinessPurpose(account: { requires_business_purpose?: boolean | null }): boolean {
  return account.requires_business_purpose === true
}

export function businessPurposeMissing(
  account: { requires_business_purpose?: boolean | null },
  purpose: string | null | undefined,
): boolean {
  if (!accountRequiresBusinessPurpose(account)) return false
  return !purpose || purpose.trim().length === 0
}

export function receiptSourceRef(documentId: string): string {
  return `receipt:${documentId}`
}

export const RECEIPT_SOURCE_REF = /^receipt:[0-9a-f-]{36}$/
export const AMAZON_SOURCE_REF = /^amazon:.+$/

export function isValidReceiptCommitRef(ref: string): boolean {
  return RECEIPT_SOURCE_REF.test(ref) || AMAZON_SOURCE_REF.test(ref)
}

export function receiptRetainUntil(occurredOn: string): string {
  const year = Number(occurredOn.slice(0, 4))
  return `${year + 7}-12-31`
}
