import { notFound } from "next/navigation"
import { requirePermission } from "@/lib/permissions/guard"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { BlogPostForm } from "@/components/admin/blog/BlogPostForm"
import { BlogPostImageWatcher } from "@/components/admin/blog/BlogPostImageWatcher"
import { ShareToLinkedInButton } from "@/components/admin/social/ShareToLinkedInButton"
import type { BlogPost } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export const metadata = { title: "Edit Blog Post" }

export default async function EditBlogPostPage({ params }: Props) {
  const session = await requirePermission("blog")
  const { id } = await params

  let post: BlogPost
  try {
    post = (await getBlogPostById(id)) as BlogPost
  } catch {
    notFound()
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-primary">Edit Blog Post</h1>
        {post.status === "published" && <ShareToLinkedInButton source={{ blogPostId: post.id }} variant="full" />}
      </div>
      <BlogPostImageWatcher postId={post.id} hasCoverImage={Boolean(post.cover_image_url)} />
      <BlogPostForm post={post} authorId={session.user!.id!} />
    </div>
  )
}
