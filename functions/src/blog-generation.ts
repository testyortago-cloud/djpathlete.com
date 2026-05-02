import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./ai/anthropic.js"
import { getSupabase } from "./lib/supabase.js"
import { fetchResearchPapers, formatResearchForPrompt } from "./lib/research.js"

// ─── System Prompt ───────────────────────────────────────────────────────────

const BLOG_GENERATION_PROMPT = `You are an expert content writer for DJP Athlete, a fitness coaching platform run by Darren Paul, a strength & conditioning coach with 20+ years of experience working with athletes at every level.

Your writing style:
- Professional but approachable — you're a real coach sharing real expertise
- Evidence-based — reference training principles, sports science concepts
- Practical — give readers actionable takeaways they can use immediately
- Engaging — use clear structure with headings, short paragraphs, and varied formatting
- No fluff, no fads — just what works

Sources and references (MANDATORY):
- The author may provide their own research material (crawled web pages, notes, uploaded documents). When present, these are your PRIMARY sources — cite from them first and extract key findings, data, and conclusions.
- Auto-discovered research papers may also be provided. Use them to supplement the author's references or as the main source when no author references exist.
- You MUST cite from provided sources using their exact URLs.
- Do NOT invent, guess, or fabricate any DOI links, PubMed URLs, or research paper URLs that were not provided to you.
- You may ALSO cite well-known organization pages you are confident exist (e.g., WHO fact sheets, NSCA position statements, ACSM guidelines).
- You MUST include at least 3-4 inline <a href="..."> source references per post, placed naturally where claims are made.
- The link text should describe what the source says — NEVER just an organization name or "click here".
- ALWAYS include a "References" or "Further Reading" section at the end with the full title of each cited paper as the link text.
- IMPORTANT: All URLs will be automatically validated after generation. Any link that returns a 404 will be removed.
- Example: <p>A <a href="https://doi.org/10.1519/JSC.0000000000004234">2022 systematic review in the Journal of Strength and Conditioning Research</a> confirmed that progressive overload is essential for long-term strength gains.</p>

Content structure:
- Start with a compelling hook or observation (no heading needed for the intro)
- Use <h2> for major sections and <h3> for subsections
- Mix paragraph text with bullet lists and blockquotes for variety
- End with a practical takeaway or call to reflection

HTML rules — ONLY use these elements:
<h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <u>, <a href="...">
Do NOT use <h1> (the title serves that purpose).
Do NOT use inline styles, classes, or <br> tags.
Use separate <p> tags for each paragraph.

Length guidelines:
- "short": ~500 words, 3-4 sections
- "medium": ~1000 words, 5-6 sections
- "long": ~1500 words, 7-8 sections

Tone guidelines:
- "professional": Authoritative, data-driven, coach-to-client educational tone
- "conversational": Friendly, relatable, first-person "I've seen this with my athletes..." style
- "motivational": Inspiring, empowering, encouraging action and commitment

You must output a JSON object with these fields:
- title: Compelling, SEO-friendly blog title (max 200 chars)
- slug: URL-friendly lowercase with hyphens only (max 200 chars)
- excerpt: Engaging summary that makes readers want to click (10-500 chars)
- content: Full blog post body as semantic HTML using ONLY the allowed elements above
- category: One of "Performance", "Recovery", "Coaching", or "Youth Development"
- tags: Array of 3-5 lowercase keyword tags
- meta_description: SEO meta description — AIM FOR 140-150 CHARACTERS (hard limit 160). Do NOT exceed 150.

Output ONLY the JSON object, no additional text.`

// ─── URL Validation ─────────────────────────────────────────────────────────

/**
 * Validates all <a href="..."> URLs in the generated HTML.
 * Removes any links that return 404 or are unreachable, keeping the link text.
 */
async function validateUrls(html: string): Promise<string> {
  const linkRegex = /<a\s+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi
  const links: { full: string; url: string; text: string }[] = []

  let match
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({ full: match[0], url: match[1], text: match[3] })
  }

  if (links.length === 0) return html

  // Check all URLs in parallel with a 8s timeout per request
  const checks = await Promise.allSettled(
    links.map(async (link) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        // Use GET with minimal download — some sites block HEAD requests
        const res = await fetch(link.url, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; DJPAthlete-Bot/1.0; +https://djpathlete.com)",
          },
        })
        clearTimeout(timeout)
        // Read and discard body to avoid memory leaks
        await res.text().catch(() => {})
        return { ...link, ok: res.status < 400 }
      } catch {
        return { ...link, ok: false }
      }
    }),
  )

  let cleaned = html
  let removed = 0

  for (const result of checks) {
    if (result.status === "fulfilled" && !result.value.ok) {
      // Replace broken link with just the text content
      cleaned = cleaned.replace(result.value.full, result.value.text)
      removed++
      console.log(`[blog-generation] Removed broken link: ${result.value.url}`)
    }
  }

  if (removed > 0) {
    console.log(`[blog-generation] Removed ${removed}/${links.length} broken links`)
  }

  return cleaned
}

// ─── URL Crawling for User References ─────────────────────────────────────────

function stripHtml(html: string): string {
  let text = html
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "")
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "")
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "")
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "")
  text = text.replace(/<[^>]+>/g, " ")
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  text = text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
  text = text.replace(/\s+/g, " ").trim()
  return text
}

async function crawlUrl(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DJPAthlete-Bot/1.0; +https://djpathlete.com)",
      },
    })
    clearTimeout(timeout)
    if (!res.ok) return ""

    const contentType = res.headers.get("content-type") ?? ""
    const raw = await res.text()

    if (contentType.includes("text/html") || raw.trimStart().startsWith("<")) {
      return stripHtml(raw).slice(0, 15_000)
    }
    return raw.slice(0, 15_000)
  } catch {
    return ""
  }
}

async function crawlUrls(urls: string[]): Promise<{ url: string; content: string }[]> {
  const results = await Promise.allSettled(urls.map(async (url) => ({ url, content: await crawlUrl(url) })))
  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ url: string; content: string }> =>
        r.status === "fulfilled" && r.value.content.length > 0,
    )
    .map((r) => r.value)
}

interface UserReferences {
  urls?: string[]
  notes?: string
  file_contents?: { name: string; content: string }[]
}

function formatUserReferences(
  crawled: { url: string; content: string }[],
  notes: string,
  fileContents: { name: string; content: string }[],
): string {
  if (crawled.length === 0 && !notes && fileContents.length === 0) return ""

  const sections: string[] = []

  if (crawled.length > 0) {
    sections.push(
      "### From provided links:\n" + crawled.map((c, i) => `[Source ${i + 1}] ${c.url}\n${c.content}`).join("\n\n"),
    )
  }

  if (notes) {
    sections.push("### Author's research notes:\n" + notes)
  }

  if (fileContents.length > 0) {
    sections.push("### From uploaded documents:\n" + fileContents.map((f) => `[${f.name}]\n${f.content}`).join("\n\n"))
  }

  return `

── USER-PROVIDED RESEARCH & REFERENCES (MANDATORY PRIMARY SOURCES) ──────
CRITICAL: The author has provided specific research material below. You MUST base the blog post primarily on THIS content.
- Extract and cite key findings, data points, statistics, and conclusions from these sources
- Use the provided URLs as your inline <a href="..."> citations — these are your MAIN references
- Do NOT substitute these with other research or papers you may know about
- If auto-discovered research is also provided below, use it ONLY to supplement (not replace) these primary sources

${sections.join("\n\n")}
────────────────────────────────────────────────────────────────`
}

// ─── Schema ──────────────────────────────────────────────────────────────────

// Hard cap to satisfy the frontend validator (lib/validators/blog-post.ts) which
// rejects meta_description > 160 chars. Truncation is silent on the rare overrun;
// the admin can still hand-edit the field.
function capMetaDescription(s: string): string {
  if (s.length <= 160) return s
  return s.slice(0, 157).trimEnd() + "…"
}

const blogResultSchema = z.object({
  title: z.string(),
  slug: z.string(),
  excerpt: z.string(),
  content: z.string(),
  category: z.enum(["Performance", "Recovery", "Coaching", "Youth Development"]),
  tags: z.array(z.string()),
  meta_description: z.string().transform(capMetaDescription),
})

// ─── Handler ─────────────────────────────────────────────────────────────────

async function isJobCancelled(jobRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  const snap = await jobRef.get()
  return snap.exists && snap.data()?.status === "cancelled"
}

export async function handleBlogGeneration(jobId: string): Promise<void> {
  const db = getFirestore()
  const jobRef = db.collection("ai_jobs").doc(jobId)

  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) return

  const job = jobSnap.data()!
  if (job.status !== "pending") return

  await jobRef.update({ status: "processing", updatedAt: FieldValue.serverTimestamp() })

  const input = job.input as {
    prompt: string
    tone?: string
    length?: string
    userId: string
    references?: UserReferences
    sourceCalendarId?: string  // NEW
  }

  const startTime = Date.now()

  try {
    // Step 1a: Process user-provided references (crawl URLs, format notes/files)
    let userRefBlock = ""
    let userRefMeta = { urls_crawled: 0, has_notes: false, files: 0 }

    if (input.references) {
      const refs = input.references
      try {
        const crawled = refs.urls?.length ? await crawlUrls(refs.urls) : []
        const refNotes = refs.notes ?? ""
        const fileContents = refs.file_contents ?? []

        userRefBlock = formatUserReferences(crawled, refNotes, fileContents)
        userRefMeta = {
          urls_crawled: crawled.length,
          has_notes: refNotes.length > 0,
          files: fileContents.length,
        }
        console.log(
          `[blog-generation] User references: ${crawled.length} URLs crawled, notes=${userRefMeta.has_notes}, files=${fileContents.length}`,
        )
      } catch (err) {
        console.warn("[blog-generation] User reference processing failed:", err)
      }
    }

    // Step 1b: Fetch auto-discovered research papers for the topic
    // Skip auto-research if user provided substantial references (URLs + notes/files)
    let researchBlock = ""
    let researchMeta = { papers: 0, source: "none", duration_ms: 0 }
    const hasSubstantialUserRefs = userRefBlock.length > 500

    if (hasSubstantialUserRefs) {
      console.log("[blog-generation] Skipping auto-research — user provided substantial references")
    } else {
      try {
        const research = await fetchResearchPapers(input.prompt)
        researchBlock = formatResearchForPrompt(research.papers)
        researchMeta = { papers: research.papers.length, source: research.source, duration_ms: research.duration_ms }
        console.log(
          `[blog-generation] Found ${research.papers.length} papers via ${research.source} in ${research.duration_ms}ms`,
        )
      } catch (err) {
        console.warn("[blog-generation] Research fetch failed, proceeding without:", err)
      }
    }

    // Check cancellation before expensive AI call
    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-generation] Job ${jobId} cancelled before AI call`)
      return
    }

    // Step 2: Generate the blog post with all reference context
    // User references come first (primary), auto-research follows (supplementary)
    const userMessage = `Write a blog post about: ${input.prompt}

Tone: ${input.tone ?? "professional"}
Target length: ${input.length ?? "medium"}
Current date: ${new Date().toISOString().slice(0, 10)}${userRefBlock}${researchBlock}`

    const result = await callAgent(BLOG_GENERATION_PROMPT, userMessage, blogResultSchema, { model: MODEL_SONNET })

    // Check cancellation after AI call
    if (await isJobCancelled(jobRef)) {
      console.log(`[blog-generation] Job ${jobId} cancelled after AI call`)
      return
    }

    // Step 3: Validate all URLs in the generated content — remove any 404s
    const validatedContent = await validateUrls(result.content.content)
    const finalResult = { ...result.content, content: validatedContent }

    const supabase = getSupabase()

    // Log generation (non-fatal)
    try {
      await supabase.from("ai_generation_log").insert({
        program_id: null,
        client_id: null,
        requested_by: input.userId,
        status: "completed",
        input_params: {
          feature: "blog_generation",
          prompt: input.prompt,
          tone: input.tone,
          length: input.length,
          research_papers: researchMeta.papers,
          research_source: researchMeta.source,
          research_duration_ms: researchMeta.duration_ms,
          user_refs_urls: userRefMeta.urls_crawled,
          user_refs_url_list: input.references?.urls ?? [],
          user_refs_has_notes: userRefMeta.has_notes,
          user_refs_notes_excerpt: (input.references?.notes ?? "").slice(0, 200),
          user_refs_files: userRefMeta.files,
          user_refs_file_names: (input.references?.file_contents ?? []).map((f) => f.name),
        },
        output_summary: `Generated blog: ${result.content.title}`,
        error_message: null,
        model_used: MODEL_SONNET,
        tokens_used: result.tokens_used,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
        current_step: 0,
        total_steps: 0,
      })
    } catch {
      /* non-fatal */
    }

    // Step 4: Insert the blog_posts row directly so downstream listeners
    // (blog_image_generation, seo_enhance) have a target. Author is the
    // requesting userId; status is 'draft' until admin publishes.
    const { data: insertedPost, error: insertErr } = await supabase
      .from("blog_posts")
      .insert({
        title: finalResult.title,
        slug: finalResult.slug,
        excerpt: finalResult.excerpt,
        content: finalResult.content,
        category: finalResult.category,
        cover_image_url: null,
        status: "draft",
        tags: finalResult.tags,
        meta_description: finalResult.meta_description,
        author_id: input.userId,
      })
      .select("id")
      .single()
    if (insertErr) {
      throw new Error(`blog_posts insert failed: ${insertErr.message}`)
    }
    const blogPostId = (insertedPost as { id: string }).id

    // Optionally link the source content_calendar row to the new blog post.
    // status enum is 'planned' | 'in_progress' | 'published' | 'cancelled' (see migration 00077);
    // we set 'in_progress' and populate reference_id with the new blog_post_id.
    if (input.sourceCalendarId) {
      await supabase
        .from("content_calendar")
        .update({
          status: "in_progress",
          reference_id: blogPostId,
        })
        .eq("id", input.sourceCalendarId)
    }

    await jobRef.update({
      status: "completed",
      result: { ...finalResult, blog_post_id: blogPostId },
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[blog-generation] Job ${jobId} failed:`, errorMessage)

    await jobRef.update({
      status: "failed",
      error: errorMessage,
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}
