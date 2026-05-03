// lib/blog/program-catalog.ts
// Next.js-side mirror of functions/src/blog/program-catalog.ts.
// Shares the same PROGRAMS data + matching logic. Keep these two files in
// sync — both are short and the catalog changes infrequently.

export interface DjpProgram {
  slug: string
  name: string
  url: string
  pitch: string
  match_tags: string[]
  match_keywords: string[]
}

export const PROGRAMS: DjpProgram[] = [
  {
    slug: "comeback-code",
    name: "Comeback Code",
    url: "https://www.darrenjpaul.com/programs/comeback-code",
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
    url: "https://www.darrenjpaul.com/programs/rotational-reboot",
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
  primary_keyword?: string | null
}

export function findRelevantProgram(input: FindProgramInput): DjpProgram | null {
  const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase()))
  const text = [input.title, input.excerpt, input.primary_keyword]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase()
  for (const p of PROGRAMS) {
    if (p.match_tags.some((t) => tagSet.has(t))) return p
    if (p.match_keywords.some((k) => text.includes(k))) return p
  }
  return null
}
