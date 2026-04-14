import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth-helpers"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm"
import type { BlogPost } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: "Edit Blog Post" }

export default async function EditBlogPostPage({ params }: Props) {
  const session = await requireAdmin()
  const { id } = await params

  let post: BlogPost
  try {
    post = (await getBlogPostById(id)) as BlogPost
  } catch {
    notFound()
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Edit Blog Post</h1>
      <BlogPostForm post={post} authorId={session.user!.id!} />
    </div>
  )
}
