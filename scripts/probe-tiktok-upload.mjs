// scripts/probe-tiktok-upload.mjs
//
//   npx tsx scripts/probe-tiktok-upload.mjs [bytes]
//
// Proves the TikTok FILE_UPLOAD path moves a file intact, WITHOUT touching
// TikTok. Only the open.tiktokapis.com calls are faked; the media host and the
// upload target are a real local HTTP server, so the Range reads and the PUT
// bodies are genuine. Compares sha256 of the original against the reassembled
// upload, and prints each chunk's declared vs actual length.
//
// 5242880    (5MB)   -> single chunk
// 136314880 (130MB)  -> two chunks, the second absorbing the remainder
import http from "node:http"
import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import os from "node:os"
import { createTikTokPlugin } from "../lib/social/plugins/tiktok.ts"

const SIZE = Number(process.argv[2] ?? 5 * 1024 * 1024)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-probe-"))
const src = path.join(dir, "video.mp4")
fs.writeFileSync(src, crypto.randomBytes(Math.min(SIZE, 64 * 1024 * 1024)))
while (fs.statSync(src).size < SIZE) {
  fs.appendFileSync(src, crypto.randomBytes(Math.min(SIZE - fs.statSync(src).size, 64 * 1024 * 1024)))
}
const original = fs.readFileSync(src)
const originalHash = crypto.createHash("sha256").update(original).digest("hex")

const received = Buffer.alloc(original.length)
const marks = []
const server = http.createServer((req, res) => {
  if (req.url === "/video.mp4") {
    const stat = fs.statSync(src)
    if (req.method === "HEAD") {
      res.writeHead(200, { "content-length": String(stat.size), "content-type": "video/mp4" })
      return res.end()
    }
    const range = req.headers["range"]
    if (range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range)
      const start = Number(m[1]),
        end = Number(m[2])
      res.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "content-length": String(end - start + 1),
      })
      return fs.createReadStream(src, { start, end }).pipe(res)
    }
    res.writeHead(200, { "content-length": String(stat.size), "content-type": "video/mp4" })
    return fs.createReadStream(src).pipe(res)
  }
  if (req.url === "/upload") {
    const cr = req.headers["content-range"]
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr ?? "")
    if (!m) {
      res.writeHead(400)
      return res.end("no content-range")
    }
    const start = Number(m[1]),
      end = Number(m[2])
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const body = Buffer.concat(chunks)
      marks.push({ start, end, declared: end - start + 1, actual: body.length })
      body.copy(received, start)
      res.writeHead(200)
      res.end("ok")
    })
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const MEDIA = `http://127.0.0.1:${port}/video.mp4`
const UPLOAD = `http://127.0.0.1:${port}/upload`

// Fake ONLY the TikTok API surface; everything else hits the real server.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.startsWith("https://open.tiktokapis.com")) {
    return new Response(JSON.stringify({ data: { publish_id: "pub_probe", upload_url: UPLOAD } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return realFetch(url, init)
}

const plugin = createTikTokPlugin({ access_token: "at", refresh_token: "rt", client_key: "ck", client_secret: "cs" })
const result = await plugin.publish({ content: "probe", mediaUrl: MEDIA, scheduledAt: null })

const receivedHash = crypto.createHash("sha256").update(received).digest("hex")
console.log("file size        :", original.length, `(${(original.length / 1048576).toFixed(1)} MB)`)
console.log("publish result   :", JSON.stringify(result))
console.log("chunks PUT       :", marks.length)
marks.forEach((m, i) =>
  console.log(
    `  chunk ${i + 1}: bytes ${m.start}-${m.end}  declared=${m.declared} actual=${m.actual}`,
    m.declared === m.actual ? "" : "  <-- MISMATCH",
  ),
)
console.log("sha256 original  :", originalHash)
console.log("sha256 received  :", receivedHash)
console.log(originalHash === receivedHash && result.success ? "PASS: byte-identical" : "FAIL")
server.close()
fs.rmSync(dir, { recursive: true, force: true })
process.exit(originalHash === receivedHash && result.success ? 0 : 1)
