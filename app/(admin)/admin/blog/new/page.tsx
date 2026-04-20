import { requireAdmin } from "@/lib/auth-helpers"
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm"

export const metadata = { title: "New Blog Post" }

interface Props {
  searchParams: Promise<{ prompt?: string }>
}

export default async function NewBlogPostPage({ searchParams }: Props) {
  const session = await requireAdmin()
  const { prompt } = await searchParams

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">New Blog Post</h1>
      <BlogPostForm authorId={session.user!.id!} initialPrompt={prompt} />
    </div>
  )
}
