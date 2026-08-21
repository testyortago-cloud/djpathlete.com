// @vitest-environment node
//
// The Twilio SANDBOX lane — a real network call against Twilio's test
// account, gated behind `TWILIO_TEST_ACCOUNT_SID` / `TWILIO_TEST_AUTH_TOKEN`.
//
// Like every other suite under `__tests__/integration/`, this one is
// excluded from the default `npm test` / `npm run test:run` run: see
// `vitest.config.ts`, which only includes `__tests__/integration/**` when
// `npm_lifecycle_event` starts with `test:integration` (i.e. `npm run
// test:integration`, currently `vitest run` with no path filter). Every
// other integration suite here opts a real Supabase DB into the run the
// same way; this one opts a real third-party API in instead, gated by its
// OWN env pair on top of that lane-level exclusion so a bare `npm run
// test:integration` still can't hit Twilio by accident on a machine that
// hasn't configured sandbox credentials.
//
// ─── Why this calls `fetch` directly, not `sendRenderedSequenceSms` ────────
//
// `sendRenderedSequenceSms` (lib/lead-engine/sms.ts) reads the PRODUCTION
// env var trio — `TWILIO_ACCOUNT_SID`, `TWILIO_MAIN_SID`,
// `TWILIO_CLIENT_SECRET` — and authenticates as an API key
// (`TWILIO_MAIN_SID:TWILIO_CLIENT_SECRET`). Twilio's TEST credentials
// (Console → Account → API keys & tokens → Test credentials) are a
// different pair — a test Account SID and a test Auth Token — and they
// authenticate DIRECTLY as `TWILIO_TEST_ACCOUNT_SID:TWILIO_TEST_AUTH_TOKEN`.
// They do NOT accept API-key auth: an API key minted against the real
// account can't authenticate the sandbox, and the sandbox Account SID isn't
// a valid target for an API-key-authenticated request either. That's why
// this suite has its own env vars instead of reusing the production three,
// and why it can't route through `sendRenderedSequenceSms` at all — that
// function's auth scheme is simply the wrong one for these credentials.
//
// This suite exists to verify TWILIO'S wire contract — the exact response
// shapes (`{ sid, status }` on success, `{ code, message }` on error) that
// `__tests__/lib/lead-engine/sms.test.ts` mocks. It is the
// mock-the-real-contract check for those mocks, not a test of our module:
// it asserts on the same fields those unit mocks assert on, fetched for
// real, so a mock that's drifted from Twilio's actual behavior gets caught
// here instead of shipping silently green.
//
// Do NOT put real credentials in this file, in any fixture, or in git —
// they come from `.env.local` only (gitignored), loaded by
// `vitest.config.ts`'s `dotenv.config({ path: ".env.local" })`.

import { describe, it, expect } from "vitest"

const TWILIO_TEST_ACCOUNT_SID = process.env.TWILIO_TEST_ACCOUNT_SID
const TWILIO_TEST_AUTH_TOKEN = process.env.TWILIO_TEST_AUTH_TOKEN
const envPresent = Boolean(TWILIO_TEST_ACCOUNT_SID) && Boolean(TWILIO_TEST_AUTH_TOKEN)

const SKIP_REASON =
  "TWILIO_TEST_ACCOUNT_SID / TWILIO_TEST_AUTH_TOKEN are not set, so the real-Twilio " +
  "sandbox calls below are skipped. Grab a test credential pair from " +
  "Console → Account → API keys & tokens → Test credentials and add them to " +
  ".env.local as TWILIO_TEST_ACCOUNT_SID / TWILIO_TEST_AUTH_TOKEN, then run " +
  "`npx vitest run __tests__/integration/twilio-sandbox.test.ts` (or `npm run test:integration`)."

// Always runs, with or without the env pair — this is the "one always-run
// test" that prints (and asserts the shape of) the skip reason so a
// `test:integration` run without sandbox creds still says exactly where the
// rest of this file went, instead of a bare "2 skipped" with no context.
it("documents where to get sandbox credentials when the real-Twilio tests are skipped", () => {
  if (!envPresent) {
    console.log(`[twilio-sandbox] ${SKIP_REASON}`)
  }
  expect(SKIP_REASON).toContain("Console → Account → API keys & tokens → Test credentials")
})

describe.skipIf(!envPresent)("Twilio sandbox — real wire contract", () => {
  const accountSid = TWILIO_TEST_ACCOUNT_SID as string
  const authToken = TWILIO_TEST_AUTH_TOKEN as string
  const auth = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64")
  const messagesUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

  async function postMessage(params: Record<string, string>) {
    const body = new URLSearchParams(params)
    const response = await fetch(messagesUrl, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })
    const json = (await response.json()) as { sid?: string; status?: string; code?: number; message?: string }
    return { status: response.status, json }
  }

  // Twilio's documented magic numbers for test credentials
  // (https://www.twilio.com/docs/iam/test-credentials#test-sms-messages):
  // +15005550006 is always a valid From/To; +15005550001 is always an
  // invalid number; +15005550000 is a From number the test account never
  // owns. These same three fields (`sid` / `code` / `message`) are exactly
  // what __tests__/lib/lead-engine/sms.test.ts asserts on against the
  // MOCKED fetch — this is that mock's real-world counterpart.

  it("valid From/To -> 201 with a sid, our error mapping stays silent", async () => {
    const { status, json } = await postMessage({
      To: "+15005551234",
      From: "+15005550006",
      Body: "sandbox check — reply STOP to opt out, HELP for help.",
    })

    expect(status).toBe(201)
    expect(typeof json.sid).toBe("string")
    expect(json.sid!.length).toBeGreaterThan(0)
    // A successful send carries no Twilio error code — the same field
    // `sendRenderedSequenceSms` checks (`!response.ok`) to decide whether to
    // throw.
    expect(json.code).toBeUndefined()
  }, 15_000)

  it("invalid To (+15005550001) -> 400 with Twilio error code 21211", async () => {
    const { status, json } = await postMessage({
      To: "+15005550001",
      From: "+15005550006",
      Body: "sandbox check — reply STOP to opt out, HELP for help.",
    })

    expect(status).toBe(400)
    expect(json.code).toBe(21211)
    // `sendRenderedSequenceSms` throws `[${code}] ${message}` — assert the
    // same `message` field it reads exists and is non-empty, without pinning
    // Twilio's exact wording (that string is theirs to change).
    expect(typeof json.message).toBe("string")
    expect(json.message!.length).toBeGreaterThan(0)
  }, 15_000)

  it("From an undocumented number (+15005550000) -> Twilio's 21606 catch-all", async () => {
    const { status, json } = await postMessage({
      To: "+15005551234",
      From: "+15005550000",
      Body: "sandbox check — reply STOP to opt out, HELP for help.",
    })

    expect(status).toBe(400)
    // Twilio's test-credentials magic-number table
    // (https://www.twilio.com/docs/iam/test-credentials#test-sms-messages)
    // documents a fixed set of From/To numbers with specific behavior
    // (+15005550006 valid, +15005550001 invalid). +15005550000 is not one of
    // the documented magic numbers itself — it's an ordinary-looking number
    // the test account doesn't own, and Twilio's table routes every such
    // "all others" From number deterministically to error 21606 ("the
    // 'From' phone number is not a valid, SMS-capable inbound phone number
    // currently owned by your account"). 21212 ("Invalid 'From' Phone
    // Number") is a different, unrelated scenario — it's what Twilio returns
    // when +15005550001 (the documented INVALID number) is reused as the
    // From value, not this case — so it does not apply here.
    expect(json.code).toBe(21606)
    expect(typeof json.message).toBe("string")
    expect(json.message!.length).toBeGreaterThan(0)
  }, 15_000)
})
