import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function check() {
  const { data, error } = await supabase
    .from("program_assignments")
    .select("id, program_id, user_id, status, created_at")

  if (error) {
    console.error(error.message)
    return
  }

  console.log(`Total assignments: ${data.length}`)
  data.forEach((a) => console.log(`  user=${a.user_id} program=${a.program_id} status=${a.status}`))
}

check()
