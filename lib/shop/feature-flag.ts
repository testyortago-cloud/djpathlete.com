export function isShopEnabled(): boolean {
  return process.env.SHOP_ENABLED === "true"
}
