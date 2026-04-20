import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getNewsletters, createNewsletter } from "@/lib/db/newsletters"
import { newsletterFormSchema } from "@/lib/validators/newsletter"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const newsletters = await getNewsletters()
    return NextResponse.json(newsletters)
  } catch (error) {
    console.error("Newsletter GET error:", error)
    return NextResponse.json({ error: "Failed to fetch newsletters" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = newsletterFormSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const newsletter = await createNewsletter({
      ...parsed.data,
      status: "draft",
      author_id: session.user.id,
      source_blog_post_id: null,
    })

    return NextResponse.json(newsletter, { status: 201 })
  } catch (error) {
    console.error("Newsletter POST error:", error)
    return NextResponse.json({ error: "Failed to create newsletter" }, { status: 500 })
  }
}
