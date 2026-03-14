import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const supabase = createServiceRoleClient()

    // Toggle subscription status
    if (body.action === "unsubscribe") {
      const { error } = await supabase
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw error
    } else if (body.action === "resubscribe") {
      const { error } = await supabase
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: null })
        .eq("id", id)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Subscriber PATCH] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceRoleClient()

    const { error } = await supabase
      .from("newsletter_subscribers")
      .delete()
      .eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Subscriber DELETE] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
