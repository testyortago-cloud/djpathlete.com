// Smoke test for the Resend audience sync.
// Run: npx tsx scripts/smoke-resend-audience.ts
import { config } from "dotenv"
config({ path: ".env.local" })

import { addContactToAudience } from "@/lib/shop/resend-audience"

async function main() {
  const audienceId = process.env.RESEND_AUDIENCE_ID
  const hasKey = Boolean(process.env.RESEND_API_KEY)
  if (!audienceId) throw new Error("RESEND_AUDIENCE_ID not set")
  if (!hasKey) throw new Error("RESEND_API_KEY not set")
  console.log(`[1/3] Target audience: ${audienceId}`)
  console.log(`      API key present: yes`)

  const testEmail = `smoke-test-${Date.now()}@djpathlete.test`
  console.log(`[2/3] Adding contact: ${testEmail}`)

  try {
    const contactId = await addContactToAudience({
      email: testEmail,
      firstName: null,
      lastName: null,
      tag: "smoke-test",
    })
    console.log(`[3/3] ✓ Contact created: ${contactId}`)
    console.log(`      → Check the audience in the Resend dashboard to confirm.`)
    console.log(`      → You can delete this test contact manually via the dashboard.`)
  } catch (e) {
    console.error("SMOKE TEST FAILED:", (e as Error).message)
    process.exit(1)
  }
}

main()
