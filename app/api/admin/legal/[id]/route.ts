import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDocumentById, updateDocument } from "@/lib/db/legal-documents"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const { id } = await params
    const doc = await getDocumentById(id)
    return NextResponse.json(doc)
  } catch {
    return NextResponse.json({ error: "Document not found" }, { status: 404 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { title, content, effective_date } = body as {
      title?: string
      content?: string
      effective_date?: string
    }

    const doc = await updateDocument(id, { title, content, effective_date })
    return NextResponse.json(doc)
  } catch (error) {
    console.error("Failed to update legal document:", error)
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 })
  }
}
