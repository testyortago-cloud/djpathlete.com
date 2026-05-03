// functions/src/blog/__tests__/voice-context.test.ts
import { describe, it, expect } from "vitest"
import {
  loadVoiceContext,
  composeBlogSystemPrompt,
  parseBlogFewShots,
  FALLBACK_VOICE_PROFILE,
  FALLBACK_BLOG_STRUCTURE,
} from "../voice-context.js"

function mkSupabase(rows: unknown) {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof loadVoiceContext>[0]
}

describe("voice-context", () => {
  describe("parseBlogFewShots", () => {
    it("returns [] for non-array input", () => {
      expect(parseBlogFewShots(null)).toEqual([])
      expect(parseBlogFewShots("foo")).toEqual([])
      expect(parseBlogFewShots({})).toEqual([])
    })

    it("filters out entries missing title or excerpt", () => {
      const out = parseBlogFewShots([
        { title: "ok", excerpt: "ok" },
        { title: "ok" },
        null,
        { caption: "social shape" },
      ])
      expect(out).toHaveLength(1)
      expect(out[0].title).toBe("ok")
    })

    it("preserves prompt and content_excerpt when present", () => {
      const out = parseBlogFewShots([
        { title: "t", excerpt: "e", prompt: "p", content_excerpt: "c" },
      ])
      expect(out[0]).toEqual({ title: "t", excerpt: "e", prompt: "p", content_excerpt: "c" })
    })
  })

  describe("loadVoiceContext", () => {
    it("returns the voice and structure prompts when both rows exist", async () => {
      const supabase = mkSupabase([
        { category: "voice_profile", prompt: "My voice", few_shot_examples: [] },
        { category: "blog_generation", prompt: "My structure", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe("My voice")
      expect(ctx.blogStructure).toBe("My structure")
      expect(ctx.fewShots).toEqual([])
      expect(ctx.usedFallback).toEqual({ voice: false, structure: false })
    })

    it("falls back when voice_profile is missing", async () => {
      const supabase = mkSupabase([
        { category: "blog_generation", prompt: "My structure", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe("My structure")
      expect(ctx.usedFallback.voice).toBe(true)
      expect(ctx.usedFallback.structure).toBe(false)
    })

    it("falls back when blog_generation is missing", async () => {
      const supabase = mkSupabase([
        { category: "voice_profile", prompt: "My voice", few_shot_examples: [] },
      ])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe("My voice")
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
      expect(ctx.usedFallback.structure).toBe(true)
    })

    it("falls back on both when no rows exist", async () => {
      const supabase = mkSupabase([])
      const ctx = await loadVoiceContext(supabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
    })

    it("falls back on supabase error", async () => {
      const errSupabase = {
        from: () => ({
          select: () => ({
            in: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      } as unknown as Parameters<typeof loadVoiceContext>[0]
      const ctx = await loadVoiceContext(errSupabase)
      expect(ctx.voiceProfile).toBe(FALLBACK_VOICE_PROFILE)
      expect(ctx.blogStructure).toBe(FALLBACK_BLOG_STRUCTURE)
      expect(ctx.usedFallback).toEqual({ voice: true, structure: true })
    })
  })

  describe("composeBlogSystemPrompt", () => {
    it("includes all four sections in order", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "VOICE",
        blogStructure: "STRUCTURE",
        programsBlock: "PROGRAMS",
        register: "casual",
      })
      const voiceIdx = out.indexOf("VOICE")
      const programsIdx = out.indexOf("PROGRAMS")
      const structureIdx = out.indexOf("STRUCTURE")
      const registerIdx = out.indexOf("REGISTER")
      expect(voiceIdx).toBeGreaterThan(-1)
      expect(programsIdx).toBeGreaterThan(voiceIdx)
      expect(registerIdx).toBeGreaterThan(programsIdx)
      expect(structureIdx).toBeGreaterThan(registerIdx)
    })

    it("emits the casual directive when register=casual", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "casual",
      })
      expect(out.toLowerCase()).toContain("casual")
    })

    it("emits the formal directive when register=formal", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "formal",
      })
      expect(out.toLowerCase()).toContain("formal")
    })

    it("renders SEO TARGET block when seoTarget is provided", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "casual",
        seoTarget: {
          primary_keyword: "youth pitching velocity",
          secondary_keywords: ["arm care", "long toss"],
          search_intent: "informational",
        },
      })
      expect(out).toContain("# SEO TARGET")
      expect(out).toContain("Primary keyword: youth pitching velocity")
      expect(out).toContain("Secondary keywords: arm care, long toss")
      expect(out).toContain("Search intent: informational")
    })

    it("omits the SEO TARGET block when seoTarget is undefined", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "casual",
      })
      expect(out).not.toContain("# SEO TARGET")
    })

    it("omits the SEO TARGET block when seoTarget has no primary_keyword", () => {
      const out = composeBlogSystemPrompt({
        voiceProfile: "v",
        blogStructure: "s",
        programsBlock: "p",
        register: "casual",
        seoTarget: { primary_keyword: "", secondary_keywords: [], search_intent: null },
      })
      expect(out).not.toContain("# SEO TARGET")
    })
  })
})
