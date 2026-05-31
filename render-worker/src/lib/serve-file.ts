// render-worker/src/lib/serve-file.ts
// Serve ONE local file over loopback (127.0.0.1) with HTTP Range support, so
// Remotion's OffthreadVideo compositor can seek it during a multi-minute render
// WITHOUT any external network. Streaming the source from a remote signed URL was
// flaky: a range fetch to GCS dropped near the end of a 6-min render ("Request
// closed" -> "No frame found at position"). A loopback server reading RAM-backed
// /tmp can't drop a connection mid-render.

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import type { AddressInfo } from "node:net"

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
}

export type LocalFileServer = { url: string; close: () => Promise<void> }

// Returns the loopback URL to hand to <OffthreadVideo src> and a close() to tear
// the server down once rendering is finished.
export function serveFileLocally(filePath: string): Promise<LocalFileServer> {
  const size = fs.statSync(filePath).size
  const contentType = VIDEO_MIME[path.extname(filePath).toLowerCase()] ?? "video/mp4"
  const server = http.createServer((req, res) => {
    const isHead = req.method === "HEAD"
    res.setHeader("Accept-Ranges", "bytes")
    res.setHeader("Content-Type", contentType)
    const range = req.headers.range
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
    // A Range header we can't parse (or an empty "bytes=-") is unsatisfiable.
    if (range && (!m || (m[1] === "" && m[2] === ""))) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` })
      res.end()
      return
    }
    if (m) {
      let start: number
      let end: number
      if (m[1] === "") {
        start = Math.max(0, size - Number(m[2])) // suffix range: last N bytes
        end = size - 1
      } else {
        start = Number(m[1])
        end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
      }
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      })
      if (isHead) return res.end()
      fs.createReadStream(filePath, { start, end }).on("error", () => res.destroy()).pipe(res)
      return
    }
    res.writeHead(200, { "Content-Length": String(size) })
    if (isHead) return res.end()
    fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `http://127.0.0.1:${port}/${path.basename(filePath)}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}
