import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { looksImageOnly, readPdfWithAstra } from "@/lib/ai/read-document"
import { MAX_REFERENCE_FILE_CHARS } from "@/lib/blog/reference-limits"

// A scanned PDF goes to Astra, which reads a page in seconds; a long one can
// take minutes.
export const maxDuration = 300

const MAX_SIZE = 15 * 1024 * 1024 // 15 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

export async function POST(request: Request) {
  try {
    const session = await auth()
    // `request` is passed because proxy.ts never runs on /api/upload, so there
    // is no stamped path header to read. Resolves to `blog` in the registry.
    if (!session?.user?.id || !(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: PDF, DOC, DOCX" }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 15 MB" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let text = ""
    let readWith: "text" | "ai" = "text"
    let aiTruncated = false

    if (file.type === "application/pdf") {
      // Import inner lib to avoid pdf-parse's default test file read
      const pdfParse = require("pdf-parse/lib/pdf-parse.js")
      const result = await pdfParse(buffer)
      text = result.text

      if (looksImageOnly(text, result.numpages ?? 1)) {
        try {
          const read = await readPdfWithAstra(buffer, file.name, { signal: request.signal })
          // Keep whichever found more. Astra coming back emptier than the
          // text layer means it failed quietly, not that the page is blank.
          if (read.text.length > text.trim().length) {
            text = read.text
            readWith = "ai"
            aiTruncated = read.truncated
          }
        } catch (err) {
          console.error(`[extract-text] AI read of ${file.name} failed:`, err)
          if (!text.trim()) {
            return NextResponse.json(
              {
                error: `${file.name} looks like a scanned document, and the AI reader couldn't read it. Try again, or paste the text into Notes.`,
              },
              { status: 502 },
            )
          }
        }
      }
    } else {
      // DOC / DOCX
      const mammoth = await import("mammoth")
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: `No readable text found in ${file.name}. Paste the text into Notes instead.` },
        { status: 422 },
      )
    }

    // Truncate to avoid sending huge payloads to the AI
    const truncated = aiTruncated || text.length > MAX_REFERENCE_FILE_CHARS
    const content = text.length > MAX_REFERENCE_FILE_CHARS ? text.slice(0, MAX_REFERENCE_FILE_CHARS) : text

    return NextResponse.json({
      name: file.name,
      content,
      truncated,
      originalLength: text.length,
      read_with: readWith,
    })
  } catch (error) {
    console.error("Text extraction error:", error)
    return NextResponse.json({ error: "Failed to extract text from document" }, { status: 500 })
  }
}
