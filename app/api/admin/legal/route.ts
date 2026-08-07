import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getAllDocuments, createDocument } from "@/lib/db/legal-documents"
import type { LegalDocumentType } from "@/types/database"
import { recordAudit } from "@/lib/audit/record"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const documents = await getAllDocuments()
  return NextResponse.json(documents)
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { document_type, title, content, effective_date } = body as {
      document_type: LegalDocumentType
      title: string
      content: string
      effective_date: string
    }

    if (!document_type || !title || !content || !effective_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const doc = await createDocument({ document_type, title, content, effective_date })

    await recordAudit({
      action: "legal_document.published",
      category: "compliance",
      target: { type: "legal_document", id: doc.id, label: doc.document_type },
      metadata: {
        version: doc.version,
        document_type: doc.document_type,
        effective_date: doc.effective_date,
      },
      request,
    })

    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    console.error("Failed to create legal document:", error)
    return NextResponse.json({ error: "Failed to create document" }, { status: 500 })
  }
}
