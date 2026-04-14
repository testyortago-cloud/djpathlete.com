import { requireAdmin } from "@/lib/auth-helpers"
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm"

export const metadata = { title: "New Blog Post" }

export default async function NewBlogPostPage() {
  const session = await requireAdmin()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">New Blog Post</h1>
      <BlogPostForm authorId={session.user!.id!} />
    </div>
  )
}
