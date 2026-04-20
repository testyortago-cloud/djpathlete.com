import { createServiceRoleClient } from "@/lib/supabase"
import type { BlogPost, BlogPostStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// AI-automation fields added in migrations 00080 & 00084 all have DB defaults or are nullable,
// so they stay optional on insert while remaining required on read.
type CreateBlogPostInput = Omit<
  BlogPost,
  "id" | "created_at" | "updated_at" | "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details"
> &
  Partial<Pick<BlogPost, "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details">>

export async function getBlogPosts(status?: BlogPostStatus): Promise<BlogPost[]> {
  const supabase = getClient()
  let query = supabase.from("blog_posts").select("*").order("created_at", { ascending: false })

  if (status) {
    query = query.eq("status", status)
  }

  const { data, error } = await query
  if (error) throw error
  return data as BlogPost[]
}

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false })
  if (error) throw error
  return data as BlogPost[]
}

export async function getBlogPostById(id: string): Promise<BlogPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("blog_posts").select("*").eq("id", id).single()
  if (error) throw error
  return data as BlogPost
}

export async function createDraftForVideo(params: {
  authorId: string
  videoUploadId: string
}): Promise<{ id: string }> {
  const supabase = getClient()
  const now = Date.now()
  const { data, error } = await supabase
    .from("blog_posts")
    .insert({
      title: "Generating from video…",
      slug: `generating-${now}`,
      content: "",
      excerpt: "",
      category: "Performance",
      tags: [],
      author_id: params.authorId,
      source_video_id: params.videoUploadId,
      status: "draft",
    })
    .select("id")
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}

export async function getPublishedBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as BlogPost
}

export async function createBlogPost(post: CreateBlogPostInput): Promise<BlogPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("blog_posts").insert(post).select().single()
  if (error) throw error
  return data as BlogPost
}

export async function updateBlogPost(
  id: string,
  updates: Partial<Omit<BlogPost, "id" | "created_at">>,
): Promise<BlogPost> {
  const supabase = getClient()
  const { data, error } = await supabase.from("blog_posts").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as BlogPost
}

export async function deleteBlogPost(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("blog_posts").delete().eq("id", id)
  if (error) throw error
}

export async function isSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
  const supabase = getClient()
  let query = supabase.from("blog_posts").select("id").eq("slug", slug)
  if (excludeId) {
    query = query.neq("id", excludeId)
  }
  const { data, error } = await query
  if (error) throw error
  return (data?.length ?? 0) > 0
}
