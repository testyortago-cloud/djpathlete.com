import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ghlGetAllContacts, isGHLConfigured } from "@/lib/ghl"
import { importSubscribers } from "@/lib/db/newsletter"

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (!isGHLConfigured()) {
      return NextResponse.json(
        { error: "GoHighLevel is not configured. Check your GHL_API_KEY and GHL_LOCATION_ID environment variables." },
        { status: 400 }
      )
    }

    // Fetch all contacts from GHL
    const contacts = await ghlGetAllContacts()

    if (contacts.length === 0) {
      return NextResponse.json({
        success: true,
        added: 0,
        skipped: 0,
        total: 0,
        message: "No contacts found in GoHighLevel",
      })
    }

    const emails = contacts.map((c) => c.email)

    // Import into Supabase (upserts — won't duplicate existing)
    const result = await importSubscribers(emails, "ghl_sync")

    return NextResponse.json({
      success: true,
      added: result.added,
      skipped: result.skipped,
      total: contacts.length,
    })
  } catch (error) {
    console.error("[GHL Sync] Error:", error)
    return NextResponse.json(
      { error: "Failed to sync from GoHighLevel" },
      { status: 500 }
    )
  }
}
