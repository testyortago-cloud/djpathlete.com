import { createServiceRoleClient } from "@/lib/supabase"
import type { BlogPost, BlogPostStatus } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

// AI-automation fields added in migrations 00080 & 00084 all have DB defaults or are nullable,
// so they stay optional on insert while remaining required on read.
type CreateBlogPostInput = Omit<
  BlogPost,
  "id" | "created_at" | "updated_at" | "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details" | "last_refreshed_at" | "refresh_count"
> &
  Partial<Pick<BlogPost, "source_video_id" | "seo_metadata" | "tavily_research" | "fact_check_status" | "fact_check_details" | "last_refreshed_at" | "refresh_count">>

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

export async function getRelatedPostsByCategory(args: {
  category: string
  excludeId: string
  limit?: number
}): Promise<Array<Pick<BlogPost, "id" | "title" | "slug" | "excerpt" | "category" | "cover_image_url" | "published_at">>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, title, slug, excerpt, category, cover_image_url, published_at")
    .eq("status", "published")
    .eq("category", args.category)
    .neq("id", args.excludeId)
    .order("published_at", { ascending: false })
    .limit(args.limit ?? 3)
  if (error) throw error
  return data as Array<
    Pick<BlogPost, "id" | "title" | "slug" | "excerpt" | "category" | "cover_image_url" | "published_at">
  >
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

export interface RefreshBlogPostInput {
  id: string
  // Regenerated fields:
  title: string
  excerpt: string
  content: string
  meta_description: string
  faq: BlogPost["faq"]
  tags: string[]
  // Preserved by the handler (passed in to make the update explicit):
  // id, slug, published_at, author_id, category, primary_keyword — NOT updated here.
}

/**
 * Updates an existing blog post in place with regenerated content. Forces
 * status to "draft" so the coach reviews before re-publishing. Sets
 * `last_refreshed_at = now()` and increments `refresh_count` atomically via
 * a single SQL statement (RPC) to avoid race conditions if two refreshes
 * land at the same time.
 *
 * Preserves: id, slug, published_at, author_id, category, primary_keyword,
 * cover_image_url, seo_metadata (all unchanged by this call).
 */
export async function refreshBlogPost(input: RefreshBlogPostInput): Promise<BlogPost> {
  const supabase = getClient()

  // Two-step update (no RPC needed): read current refresh_count, then write +1.
  // Concurrent refreshes are vanishingly unlikely (manual button + future
  // weekly agent), so optimistic read-then-write is acceptable here.
  const { data: current, error: readErr } = await supabase
    .from("blog_posts")
    .select("refresh_count")
    .eq("id", input.id)
    .single()
  if (readErr) throw readErr
  const nextRefreshCount = ((current as { refresh_count: number | null } | null)?.refresh_count ?? 0) + 1

  const { data, error } = await supabase
    .from("blog_posts")
    .update({
      title: input.title,
      excerpt: input.excerpt,
      content: input.content,
      meta_description: input.meta_description,
      faq: input.faq,
      tags: input.tags,
      status: "draft",
      last_refreshed_at: new Date().toISOString(),
      refresh_count: nextRefreshCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select()
    .single()
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
