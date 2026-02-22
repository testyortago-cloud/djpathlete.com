import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createServiceRoleClient()

    const { error } = await supabase
      .from("google_reviews")
      .delete()
      .eq("id", id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete review. Please try again." },
      { status: 500 }
    )
  }
}
