import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

const MAX_SIZE = 15 * 1024 * 1024 // 15 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PDF, DOC, DOCX" },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum 15 MB" },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let text = ""

    if (file.type === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default
      const result = await pdfParse(buffer)
      text = result.text
    } else {
      // DOC / DOCX
      const mammoth = await import("mammoth")
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    }

    // Truncate to avoid sending huge payloads to the AI
    const maxChars = 50_000
    const truncated = text.length > maxChars
    const content = truncated ? text.slice(0, maxChars) : text

    return NextResponse.json({
      name: file.name,
      content,
      truncated,
      originalLength: text.length,
    })
  } catch (error) {
    console.error("Text extraction error:", error)
    return NextResponse.json(
      { error: "Failed to extract text from document" },
      { status: 500 }
    )
  }
}
