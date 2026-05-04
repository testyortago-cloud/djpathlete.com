import { NextResponse } from "next/server"
import { z } from "zod"
import { compare, hash } from "bcryptjs"
import { auth } from "@/lib/auth"
import { getUserById, updateUser } from "@/lib/db/users"

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .max(128, "Password is too long"),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "New password must be different from your current password",
    path: ["newPassword"],
  })

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  let user
  try {
    user = await getUserById(session.user.id)
  } catch {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  const ok = await compare(parsed.data.currentPassword, user.password_hash)
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect", details: { currentPassword: ["Incorrect password"] } },
      { status: 400 },
    )
  }

  const password_hash = await hash(parsed.data.newPassword, 12)
  await updateUser(user.id, { password_hash })

  return NextResponse.json({ success: true })
}
