// functions/src/blog/program-catalog.ts
// Static catalog of DJP coaching programs. Used by blog-generation to inject
// "DJP PROGRAMS" context into the system prompt, and (Phase 5) by the public
// renderer to pick a context-aware bottom CTA.
//
// Keep in sync with the public-side equivalent if/when it lands in lib/.

export interface DjpProgram {
  slug: string
  name: string
  url: string
  pitch: string
  /** Lowercase tag substrings that trigger this program. Matched against post.tags. */
  match_tags: string[]
  /** Lowercase phrases matched against title + excerpt + primary_keyword. */
  match_keywords: string[]
}

export const PROGRAMS: DjpProgram[] = [
  {
    slug: "comeback-code",
    name: "Comeback Code",
    url: "https://djpathlete.com/programs/comeback-code",
    pitch: "Structured return-to-performance program for athletes coming back from injury, layoff, or chronic limitation.",
    match_tags: [
      "recovery",
      "rehab",
      "rehabilitation",
      "return-to-sport",
      "injury",
      "comeback",
      "post-surgery",
    ],
    match_keywords: [
      "return to sport",
      "post-injury",
      "post-surgery",
      "comeback",
      "rehab",
      "rehabilitation",
      "deload",
      "recovery program",
    ],
  },
  {
    slug: "rotational-reboot",
    name: "Rotational Reboot",
    url: "https://djpathlete.com/programs/rotational-reboot",
    pitch: "Rotational power and movement program for pitchers, golfers, throwers, and racquet-sport athletes.",
    match_tags: [
      "rotational",
      "pitching",
      "throwing",
      "golf",
      "tennis",
      "baseball",
      "softball",
      "racquet",
    ],
    match_keywords: [
      "rotational power",
      "throwing velocity",
      "pitching velocity",
      "pitch",
      "golf swing",
      "tennis serve",
      "racquet",
      "bat speed",
    ],
  },
]

export interface FindProgramInput {
  tags?: string[]
  title?: string
  excerpt?: string
  primary_keyword?: string
}

export function findRelevantProgram(input: FindProgramInput): DjpProgram | null {
  const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase()))
  const text = [input.title, input.excerpt, input.primary_keyword].filter(Boolean).join(" ").toLowerCase()
  for (const p of PROGRAMS) {
    if (p.match_tags.some((t) => tagSet.has(t))) return p
    if (p.match_keywords.some((k) => text.includes(k))) return p
  }
  return null
}

export function formatProgramsForPrompt(): string {
  const lines = PROGRAMS.map(
    (p) =>
      `- ${p.name} (${p.url})\n  ${p.pitch}\n  Mention when topic relates to: ${p.match_keywords.slice(0, 4).join(", ")}`,
  )
  return [
    "# DJP PROGRAMS",
    "If the post topic is contextually relevant to one of the following programs, mention the program by name once in the body. Do not insert a hyperlink — link insertion happens in a later step. If nothing is relevant, do not mention any program.",
    "",
    ...lines,
  ].join("\n")
}
