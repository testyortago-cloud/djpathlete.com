export function isShopEnabled(): boolean {
  return process.env.SHOP_ENABLED === "true"
}

export function isShopDigitalEnabled(): boolean {
  return process.env.SHOP_DIGITAL_ENABLED === "true"
}

export function isShopAffiliateEnabled(): boolean {
  return process.env.SHOP_AFFILIATE_ENABLED === "true"
}
