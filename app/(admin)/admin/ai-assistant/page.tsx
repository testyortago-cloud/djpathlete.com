import { requireAdmin } from "@/lib/auth-helpers"
import { AdminAiChat } from "@/components/admin/AdminAiChat"

export const metadata = { title: "AI Assistant | Admin | DJP Athlete" }

export default async function AiAssistantPage() {
  await requireAdmin()

  return <AdminAiChat />
}
