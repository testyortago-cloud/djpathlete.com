import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const tables = ["shop_products", "shop_variants", "shop_orders"]
for (const t of tables) {
  const { error, count } = await sb.from(t).select("*", { count: "exact", head: true })
  console.log(t.padEnd(18), error ? `MISSING: ${error.message}` : `OK (rows=${count})`)
}
