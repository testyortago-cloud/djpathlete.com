# AI Query Catalog — DJP Athlete

*Last updated: 2026-05-07*

A working inventory of how athletes, parents, agents, and physiotherapists actually phrase queries to AI assistants (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews) when researching topics adjacent to the DJP Athlete brand — and where each query is now answered on the site.

## Why this exists

Per 2026 AI search research:
- **67% of AI search queries are full questions** (not bare keywords)
- **Long-tail (7+ word) queries trigger AI Overviews 61.9% more often**
- **Pages whose H2/H3 headings match the user's query verbatim get cited by ChatGPT 41% of the time** vs 29% for loosely related headings
- **Optimal answer-block length is 50–60 words** ("nuggetization") to 134–167 words ("semantic units")

Sources:
- [Citescope AI: optimizing long-tail conversational queries 2026](https://www.citescopeai.com/blog/how-to-optimize-long-tail-conversational-queries-for-ai-search-engines-in-2026)
- [Profound: what AI engines actually search for](https://www.tryprofound.com/blog/what-ai-engines-actually-search-for)
- [SearchEngineLand: AI optimization is long-tail SEO done right](https://searchengineland.com/ai-optimization-long-tail-seo-469315)
- [ALM: AI search & long-tail SEO 2026 guide](https://almcorp.com/blog/ai-search-long-tail-seo-strategy-guide/)

## Query-mapping rules we follow

1. **H2/H3 must match query syntax verbatim** (e.g., "What is X?" not "X explained")
2. **Self-contained answer in first 50–60 words** under each question heading
3. **Long-form expansion in the next 134–167 words** for semantic-unit extraction
4. **FAQPage schema on every page that hosts Q&A blocks** (already 5 pages: /online, /faq, /services/online-vs-in-person, /services/coaching-vs-training-app, /assessment HowTo)
5. **One canonical answer per question** — duplicate questions across pages should link to a primary answer, not duplicate content

## Query categories & coverage

### A. Brand & entity queries (must own 100%)

| Query | Primary page | Status |
|---|---|---|
| who is darren j paul | /about | ✅ FAQ + Person schema |
| darren j paul phd | /about | ✅ Schema + visible H1 |
| djp athlete reviews | / + /testimonials | ✅ GoogleReviewsBadge live |
| darren j paul sports performance | /contact + GBP | ✅ LocalBusiness schema |
| the grey zone framework | /philosophy | ✅ DefinedTerm + semantic block |
| five pillar framework | /philosophy | ✅ DefinedTerm + visible content |
| return-to-performance | /assessment | ✅ DefinedTerm + HowTo + semantic block |

### B. Service-defining "What is X?" queries

| Query | Primary page | Coverage |
|---|---|---|
| what is online sports performance coaching | /online | ✅ Semantic block |
| what is in-person sports performance training | /in-person | ✅ Semantic block |
| what is return-to-performance assessment | /assessment | ✅ Semantic block + HowTo |
| what is the grey zone framework | /philosophy | ✅ Semantic block |
| what is sports performance coaching | /services + /faq | ✅ FAQ |
| what is a performance blueprint | /glossary#performance-blueprint | ✅ DefinedTerm |
| what is autoregulation in training | /glossary#autoregulation | ✅ DefinedTerm |
| what is force platform testing | /glossary#force-platform-testing | ✅ DefinedTerm + linked from /assessment |
| what is long-term athlete development | /glossary#long-term-athlete-development | ✅ DefinedTerm |
| what is the difference between capacity and readiness | /glossary | ✅ Two adjacent DefinedTerm entries |

### C. Comparison queries (33% of AI citations per ai-seo skill)

| Query | Primary page | Coverage |
|---|---|---|
| online vs in-person sports performance coaching | /services/online-vs-in-person | ✅ Comparison page + FAQPage |
| sports performance coaching vs training app | /services/coaching-vs-training-app | ✅ Comparison page + FAQPage |
| sports performance coach vs personal trainer | /faq#comparison | ✅ FAQ entry |
| return-to-performance vs rehab | /faq#assessment + /glossary#return-to-performance | ✅ FAQ + DefinedTerm |
| supervised coaching vs automated workouts | /services/coaching-vs-training-app | ✅ Comparison page |
| youth coaching vs adult coaching | /faq#youth (partial) | ⚠️ Partially — could expand |

### D. Decision / qualification queries

| Query | Primary page | Coverage |
|---|---|---|
| are sports performance coaches worth it | /faq#comparison | ✅ FAQ |
| do online sports performance programs work | /faq#comparison | ✅ FAQ |
| how do i find a good sports performance coach | /faq#comparison | ✅ FAQ |
| what should i ask a strength coach | /faq#youth | ✅ FAQ (parent angle) |
| how much does sports performance coaching cost | /faq#logistics | ✅ FAQ (transparent posture) |
| how long until i see results from coaching | /faq#logistics | ✅ FAQ (timelines by phase) |
| who is sports performance coaching for | /faq#general | ✅ FAQ |
| who shouldn't get sports performance coaching | implicit in /faq + anti-persona | ⚠️ Could be more explicit |

### E. Return-to-sport / injury queries (highest commercial intent)

| Query | Primary page | Coverage |
|---|---|---|
| when can i return to sport after acl | /faq#comparison + /assessment | ✅ FAQ + linked to /assessment |
| difference between rehab and return-to-sport | /assessment + /glossary | ✅ Definitional content |
| what does a return-to-sport assessment include | /faq#assessment | ✅ FAQ |
| who do you collaborate with on rehab cases | /faq#assessment | ✅ FAQ |
| how do i know when i'm ready to compete again | /assessment | ✅ Editorial content |
| why do athletes reinjure after rehab | /assessment + planned blog post | ⚠️ Editorial coverage; blog post pending |

### F. Youth athlete / parent queries

| Query | Primary page | Coverage |
|---|---|---|
| is strength training safe for my child | /faq#youth | ✅ FAQ |
| will lifting weights stunt my child's growth | /faq#youth | ✅ FAQ (myth-bust) |
| what age should kids start strength training | /faq#youth | ✅ FAQ |
| what should i ask a youth strength coach | /faq#youth | ✅ FAQ (5-question framework) |
| will strength training prevent sport injuries in my young athlete | /faq#youth | ✅ FAQ |
| youth speed and agility training tampa | /clinics | ✅ /clinics page |

### G. In-person / location queries (Tampa Bay anchor)

| Query | Primary page | Coverage |
|---|---|---|
| where is darren j paul sports performance located | /faq#in-person | ✅ FAQ |
| sports performance coach zephyrhills | /in-person + GBP | ✅ Local schema + GBP |
| sports performance coach tampa | /in-person | ⚠️ Partial — needs Tampa-specific landing |
| strength and conditioning coach tampa bay | /in-person | ⚠️ Partial |
| athletic trainer for athletes near me | GBP + LocalBusiness schema | ✅ Schema-only signal |
| who do you coach in tampa bay | /faq#in-person + /testimonials | ✅ FAQ |

**Pending:** /locations/tampa-bay umbrella page (master plan §4.3)

### H. Process / "How does X work?" queries (HowTo schema territory)

| Query | Primary page | Coverage |
|---|---|---|
| how does a return-to-performance assessment work | /assessment | ✅ 4-step HowTo schema + visible content |
| what does a typical week of online coaching look like | /faq#online | ✅ FAQ |
| how do i start with online coaching | /faq#online | ✅ FAQ + apply link |
| how do i apply for in-person coaching | /in-person#apply | ✅ Inline form |
| how does video review work | /faq#online + /online components section | ✅ Multiple touchpoints |

### I. Methodology / "Why X works" queries

| Query | Primary page | Coverage |
|---|---|---|
| why do most online programs fail | /online editorial section | ✅ "Why most fail" 5-point list |
| why is training in extremes a problem | /philosophy | ✅ Editorial content |
| why does coach-supervised cost more than apps | /services/coaching-vs-training-app | ✅ FAQ + comparison |
| why is the assessment phase important | /assessment | ✅ Editorial content |

### J. Sport-specific queries (selective expansion area)

| Query | Primary page | Coverage |
|---|---|---|
| sports performance coach for tennis | /testimonials (WTA) + /in-person | ⚠️ Implicit; explicit page would lift |
| sports performance training for soccer | /camps | ✅ /camps (high-performance soccer camp) |
| sports performance coach for pickleball | /testimonials | ⚠️ Implicit |
| strength training for golf athletes | none | ❌ Gap — opportunity |
| return to sport after acl for soccer player | /assessment + planned blog | ⚠️ Generic only |

**Note:** These are P2-P3 expansion opportunities — only build sport-specific landing pages where Darren has direct experience and verified athlete examples.

## Anti-queries (we deliberately do NOT optimize for these)

These conflict with the brand's anti-persona and would dilute the signal:

- "personal trainer near me"
- "fitness coach"
- "weight loss coach"
- "transformation coach"
- "bootcamp"
- "crossfit gym"
- "beach body"
- "ripped in 30 days"
- "bodybuilding coach"

## Where each AI assistant gets canonical answers

When AI assistants crawl darrenjpaul.com, the answer to any question above is sourced from one of these surfaces (in priority order):

1. **`public/llms.txt`** — pre-formatted Q&A blocks for direct quotation (10+ canonical answers)
2. **`public/AGENTS.md`** — agent-oriented capability declaration with service catalog and interaction guidance
3. **`/faq`** — 28 Q&As across 6 groups, all with FAQPage JSON-LD
4. **`/glossary`** — 12 DefinedTerm entries in a DefinedTermSet
5. **Money-page semantic answer blocks** — 4 pages (`/online`, `/in-person`, `/assessment`, `/philosophy`) with 134–167 word self-contained answers under H2 headings
6. **Comparison pages** — 2 pages (`/services/online-vs-in-person`, `/services/coaching-vs-training-app`) with comparison tables, scenario-fit guidance, and FAQPage schema
7. **Page-level `Service`, `Person`, `LocalBusiness`, `HowTo`, and `BreadcrumbList` JSON-LD** — entity-graph signals beyond the visible content

## Unblocked next moves (in priority order)

1. **Sport-specific landing pages** — where the coach has direct experience (tennis, soccer, golf — only with athlete-name permission)
2. **`/locations/tampa-bay`** umbrella page — local-SEO signal for "Tampa", "Wesley Chapel", "Lakeland" geo queries (master plan §4.3)
3. **Blog cluster C (Return-to-Performance)** — 8 articles supporting the highest-commercial-intent queries (master plan §6.2)
4. **Why-athletes-reinjure post** — fills the only gap in category E
5. **Anti-persona explicit content** — "Who shouldn't hire a sports performance coach" (counterintuitive engagement value, AI assistants love disqualifying frameworks)
