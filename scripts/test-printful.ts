import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const BASE = "https://api.printful.com"

function mask(v: string | undefined) {
  if (!v) return "(unset)"
  if (v.length <= 8) return "***"
  return `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})`
}

async function pf(path: string) {
  const key = process.env.PRINTFUL_API_KEY
  if (!key) throw new Error("PRINTFUL_API_KEY not set")
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  if (process.env.PRINTFUL_STORE_ID) h["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID
  const res = await fetch(`${BASE}${path}`, { headers: h, signal: AbortSignal.timeout(15_000) })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

async function main() {
  console.log("=== Printful connectivity test ===\n")
  console.log("Env check:")
  console.log("  PRINTFUL_API_KEY       :", mask(process.env.PRINTFUL_API_KEY))
  console.log("  PRINTFUL_STORE_ID      :", process.env.PRINTFUL_STORE_ID || "(unset)")
  console.log("  PRINTFUL_WEBHOOK_SECRET:", mask(process.env.PRINTFUL_WEBHOOK_SECRET))
  console.log("  SHOP_ENABLED           :", process.env.SHOP_ENABLED)
  console.log()

  if (!process.env.PRINTFUL_API_KEY) {
    console.error("✗ PRINTFUL_API_KEY is missing — stop here.")
    process.exit(1)
  }

  console.log("1) GET /stores  (verify API key works at all)")
  const stores = await pf("/stores")
  if (!stores.ok) {
    console.error(`  ✗ ${stores.status}`, stores.body)
    process.exit(1)
  }
  const list = (stores.body?.result ?? []) as Array<{ id: number; name: string; type: string }>
  console.log(`  ✓ ${list.length} store(s) on this account:`)
  for (const s of list) console.log(`      - id=${s.id}  name="${s.name}"  type=${s.type}`)
  console.log()

  const storeIdEnv = process.env.PRINTFUL_STORE_ID
  if (storeIdEnv) {
    const match = list.find((s) => String(s.id) === storeIdEnv)
    if (match) console.log(`  ✓ PRINTFUL_STORE_ID=${storeIdEnv} matches "${match.name}" (${match.type})`)
    else console.warn(`  ⚠ PRINTFUL_STORE_ID=${storeIdEnv} is NOT in the list above — check the value.`)
    console.log()
  }

  console.log("2) GET /store  (optional — store info; needs stores_list/read scope)")
  const store = await pf("/store")
  if (store.ok) {
    const sb = store.body?.result
    console.log(`  ✓ store id=${sb?.id}  name="${sb?.name}"  type=${sb?.type}  currency=${sb?.currency}`)
  } else {
    console.log(`  ⚠ ${store.status} — this endpoint isn't used by the app, safe to skip.`)
  }
  console.log()

  console.log("3) GET /store/products  (list synced products — USED by the app)")
  const products = await pf("/store/products")
  if (!products.ok) {
    console.error(`  ✗ ${products.status}`, products.body)
    process.exit(1)
  }
  const p = (products.body?.result ?? []) as Array<{ id: number; name: string; variants: number; synced: number }>
  console.log(`  ✓ ${p.length} product(s) in this store`)
  for (const prod of p.slice(0, 10)) {
    console.log(`      - id=${prod.id}  "${prod.name}"  variants=${prod.variants}  synced=${prod.synced}`)
  }
  if (p.length === 0) {
    console.log("      (empty — that's expected for a brand-new store; add products in the Printful dashboard)")
  }
  console.log()

  console.log("=== All Printful checks passed ✓ ===")
}

main().catch((err) => {
  console.error("✗ Test failed:", err)
  process.exit(1)
})
