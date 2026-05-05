// scripts/grant-ga4-access.mjs
//
// One-shot helper that grants the GA4 service account Viewer access on a
// property by calling the Admin API directly. Bypasses the GA4 web UI's
// "this email is not a Google account" validation that blocks adding
// service accounts via the human flow.
//
// Run:   node scripts/grant-ga4-access.mjs
// Then:  open the printed URL, sign in with your GA4 admin Google account.
//
// On success the service account is granted predefinedRoles/viewer on the
// configured property and the script exits 0. Re-running is safe — Google
// returns ALREADY_EXISTS, which we treat as success.

import { OAuth2Client } from "google-auth-library"
import http from "node:http"
import { URL } from "node:url"

// ---- Configuration (edit if reusing for a different SA / property) ----

// Secrets come from .env.local — never commit them. Run with:
//   node --env-file=.env.local scripts/grant-ga4-access.mjs
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const SERVICE_ACCOUNT_EMAIL =
  process.env.GA4_SERVICE_ACCOUNT_EMAIL ??
  "ga4-430@darrenjpaulcom.iam.gserviceaccount.com"
const PROPERTY_ID = process.env.GA4_PROPERTY_ID ?? "533252977"

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "✗ Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in env.\n" +
      "  Add them to .env.local and re-run with --env-file=.env.local",
  )
  process.exit(1)
}

// Loopback redirect — Google Cloud's Desktop OAuth client allows any
// http://localhost:* redirect by default.
const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`

// ---- OAuth dance ----

const oauth2 = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  // analytics.manage.users — write access bindings.
  // analytics.readonly — read account/property list (so we can show what
  // the signed-in user can see when troubleshooting a 404).
  // userinfo.email — confirm WHICH Google account signed in.
  scope: [
    "https://www.googleapis.com/auth/analytics.manage.users",
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
})

console.log("\n=== GA4 access binding helper ===")
console.log("Property : ", PROPERTY_ID)
console.log("Granting : ", SERVICE_ACCOUNT_EMAIL)
console.log("Role     :  predefinedRoles/viewer\n")
console.log("1) Open this URL in a browser signed in as the GA4 admin:\n")
console.log("   " + authUrl + "\n")
console.log("2) After you allow, you'll be redirected to localhost — leave")
console.log("   the page open until this script confirms success.\n")
console.log("Listening on " + REDIRECT_URI + " ...")

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith("/oauth-callback")) {
    res.writeHead(404)
    res.end("Not found")
    return
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const code = url.searchParams.get("code")
  const oauthErr = url.searchParams.get("error")

  if (oauthErr || !code) {
    res.writeHead(400, { "content-type": "text/html" })
    res.end(`<h2>OAuth error: ${oauthErr ?? "no code returned"}</h2>`)
    console.error("\n✗ OAuth failed:", oauthErr ?? "no code")
    server.close()
    process.exit(1)
  }

  try {
    // Exchange code → tokens
    const { tokens } = await oauth2.getToken(code)
    oauth2.setCredentials(tokens)
    const accessToken = tokens.access_token
    if (!accessToken) throw new Error("OAuth response had no access_token")

    // -1) Print the scopes Google actually granted. If analytics scopes
    // are missing here, the rest of the script will fail no matter what
    // the user's GA4 access is — the token is the wrong shape.
    console.log("\nScopes granted:", tokens.scope ?? "(none in response)")

    // 0) Confirm WHICH Google account just signed in
    const whoamiResp = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const whoami = await whoamiResp.json().catch(() => ({}))
    console.log("\nSigned in as:", whoami.email ?? "(unknown)")

    // 1) Confirm the user can see this property (and list what they CAN see)
    const propResp = await fetch(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (propResp.status === 404 || propResp.status === 403) {
      // Print the raw error body — distinguishes "API not enabled" (which
      // looks identical to "no access") from a real permissions issue.
      const propErr = await propResp.json().catch(() => ({}))
      console.error(`\nProperty GET → HTTP ${propResp.status}:`)
      console.error(JSON.stringify(propErr, null, 2))
      console.error(
        `\n✗ Account ${whoami.email} cannot see property ${PROPERTY_ID}.`,
      )
      console.error("  Listing properties visible to this account so you")
      console.error("  can pick the right ID...\n")

      const acctResp = await fetch(
        "https://analyticsadmin.googleapis.com/v1beta/accounts",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const acctJson = await acctResp.json().catch(() => ({}))
      const accounts = acctJson.accounts ?? []
      if (accounts.length === 0) {
        console.error("  (No GA4 accounts visible. You're signed in as the")
        console.error("   wrong Google account, OR you have no GA4 access at all.)")
      }
      for (const a of accounts) {
        const acctId = a.name.replace("accounts/", "")
        console.error(`  Account ${acctId}: ${a.displayName}`)
        const psr = await fetch(
          `https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/${acctId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        const psj = await psr.json().catch(() => ({}))
        for (const p of psj.properties ?? []) {
          const pid = p.name.replace("properties/", "")
          console.error(`    ↳ Property ${pid}: ${p.displayName}`)
        }
      }
      console.error(
        "\n  → Either sign in with a different Google account that owns property",
        PROPERTY_ID,
      )
      console.error(
        "    or update PROPERTY_ID at the top of this script to one of the IDs above.",
      )

      res.writeHead(403, { "content-type": "text/html" })
      res.end(
        `<h2>✗ Wrong account or wrong property ID</h2><p>Check the terminal — it lists what this account CAN see.</p>`,
      )
      server.close()
      process.exit(1)
    }

    // 1.5) Show what bindings already exist (helps debug "already there" cases)
    const listResp = await fetch(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}/accessBindings`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const listJson = await listResp.json().catch(() => ({}))
    console.log("\nExisting access bindings on property:")
    for (const b of listJson.accessBindings ?? []) {
      console.log(`  ${b.user ?? "?"}  →  ${(b.roles ?? []).join(", ")}`)
    }

    // 2) Try to create the binding — first v1beta, then v1alpha as a fallback.
    async function tryCreate(version) {
      const url = `https://analyticsadmin.googleapis.com/${version}/properties/${PROPERTY_ID}/accessBindings`
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user: SERVICE_ACCOUNT_EMAIL,
          roles: ["predefinedRoles/viewer"],
        }),
      })
      const text = await resp.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = null }
      console.log(`\n${version} POST → HTTP ${resp.status} ${resp.statusText}`)
      console.log(`  body: ${text || "(empty)"}`)
      return { resp, body: parsed ?? {} }
    }

    let { resp: apiResp, body } = await tryCreate("v1beta")
    if (!apiResp.ok && apiResp.status === 404) {
      console.log("\nv1beta returned 404 — retrying with v1alpha...")
      ;({ resp: apiResp, body } = await tryCreate("v1alpha"))
    }

    res.writeHead(200, { "content-type": "text/html" })

    if (apiResp.ok) {
      res.end(
        `<h2>✓ Access granted</h2><p>You can close this tab and return to the terminal.</p>`,
      )
      console.log("\n✓ Granted Viewer access on property", PROPERTY_ID)
      console.log("  to:", SERVICE_ACCOUNT_EMAIL)
      console.log("  binding name:", body.name)
      server.close()
      process.exit(0)
    }

    // ALREADY_EXISTS = the binding is already in place. Treat as success.
    if (apiResp.status === 409 || body?.error?.status === "ALREADY_EXISTS") {
      res.end(
        `<h2>✓ Already granted</h2><p>The service account already has access. Safe to close.</p>`,
      )
      console.log("\n✓ Service account already has access on property", PROPERTY_ID, "(ALREADY_EXISTS)")
      server.close()
      process.exit(0)
    }

    res.end(
      `<h2>✗ API call failed (${apiResp.status})</h2><pre>${JSON.stringify(body, null, 2)}</pre>`,
    )
    console.error("\n✗ Admin API failed:", apiResp.status)
    console.error(JSON.stringify(body, null, 2))
    server.close()
    process.exit(1)
  } catch (e) {
    res.writeHead(500, { "content-type": "text/html" })
    res.end(`<h2>✗ Script error</h2><pre>${String(e?.message ?? e)}</pre>`)
    console.error("\n✗ Script error:", e?.message ?? e)
    server.close()
    process.exit(1)
  }
})

server.listen(PORT)
