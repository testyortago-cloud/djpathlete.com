import { requireAdmin } from "@/lib/auth-helpers"
import { getDocumentById } from "@/lib/db/legal-documents"
import { notFound } from "next/navigation"
import { LegalDocumentEditor } from "@/components/admin/LegalDocumentEditor"

export const dynamic = "force-dynamic"
export const metadata = { title: "Edit Legal Document | DJP Athlete Admin" }

export default async function AdminLegalEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params

  let doc
  try {
    doc = await getDocumentById(id)
  } catch {
    notFound()
  }

  return <LegalDocumentEditor document={doc} />
}
