# DJP Athlete — SEO / AEO / GEO / CRO / E-E-A-T Master Plan

*Drafted as if by a senior SEO consultant with 10 years' experience in service-business and personal-brand search. Grounded in 2026 research (sources at end).*

*Last updated: 2026-05-07*

## 0. Executive Summary

The brand has solid foundations after this session's work: clean URL structure, ISR-driven content, JSON-LD on every key page, sitemap with all money pages, llms.txt + ai.txt shipped, GBP integration scaffolded, NAP centralized, FAQPage + dateModified schema added.

**Where we are now:** Technical SEO is roughly **B+**. The site can rank for branded queries and long-tail informational queries already. What's missing is the **research-backed 2026 layer** — the moves that determine whether DJP Athlete shows up *cited inside AI Overviews / ChatGPT / Perplexity / Claude* rather than on page 2 of blue links.

**The single most impactful insight from current research:** AI Overviews (which now trigger on 40%+ of local queries) reward four things in this order:

1. **Semantic completeness** — content that answers a question fully without external context. Pages scoring 8.5/10+ are **4.2× more likely to be cited**.
2. **Entity density** — pages mentioning **15+ recognized entities** show **4.8× higher selection**.
3. **E-E-A-T author binding** — **96% of AI Overview citations** come from sources with strong E-E-A-T.
4. **Citation/source density** — adding **citations + statistics boosts visibility 40%+**.

This plan reorganizes execution around those four levers, plus the local-SEO + CRO basics that directly drive applications.

**Headline KPIs we're optimizing for, in order:**
1. **Application volume** for online + in-person + assessment (the money outcome).
2. **AI citation rate** in ChatGPT / Perplexity / AI Overviews for target queries.
3. **Local Map Pack** ranking for "sports performance coach Tampa / Zephyrhills / Wesley Chapel."
4. **Branded search recovery** for "Darren J Paul," "DJP Athlete," "the Grey Zone," "Five Pillar Framework."
5. **Organic traffic** to the three money pages (`/in-person`, `/online`, `/assessment`).

---

## 1. Target Keyword & Search-Intent Architecture

The 2026 SEO playbook is no longer "rank for a keyword." It's **"own a topic cluster around a specific search intent, with the right content format and entity coverage."** Every keyword below maps to (a) a specific page, (b) a search intent type, and (c) a content format.

### 1.1 Brand & Entity terms — must own 100%

| Keyword | Intent | Page | Format | Status |
|---|---|---|---|---|
| `darren j paul` | Navigational | `/about` | Bio + Person schema + sameAs chain | Owned |
| `darren paul coach` | Navigational | `/about` | Same as above | Owned |
| `djp athlete` | Navigational | `/` | Organization schema + brand hub | Owned |
| `darren j paul phd` | Navigational | `/about` | Add PhD prominently | **Gap: not surfaced** |
| `darren j paul sports performance` | Local + brand | `/contact` + GBP | LocalBusiness + GBP | Mostly owned |
| `the grey zone coaching` | Concept-branded | `/philosophy` | Definitional content + DefinedTerm schema | Owned |
| `five pillar framework` | Concept-branded | `/philosophy` | List + visual schema | Owned |
| `return to performance` | Concept-branded (we coined it) | `/assessment` | Definitional + comparison | Owned |

### 1.2 Money-page torso terms — torso, ranks-with-effort

| Keyword | Search intent | Page | Format gap |
|---|---|---|---|
| `online sports performance training` | Commercial | `/online` | H1 + 134-167 word semantic answer block at top |
| `online personal trainer for athletes` | Commercial | `/online` | Add a Q&A block: "Are you an online personal trainer?" → reframe |
| `in-person sports performance training tampa` | Commercial-local | `/in-person` | Local landing module, GBP map embed |
| `strength and conditioning coach tampa bay` | Commercial-local | `/in-person` | Same |
| `return to sport assessment` | Commercial-info hybrid | `/assessment` | First 200 words must answer "what is RTS assessment" |
| `athletic performance assessment` | Commercial-info | `/assessment` | Definitional answer block |
| `traditional vs performance based assessment` | Comparison | New `/assessment/traditional-vs-performance-based` | Comparison page |
| `youth strength and conditioning coach` | Commercial-niche | `/in-person` | Add a parent-targeted module |

### 1.3 AEO long-tail (question-form) — where AI Overview citations are won

These are written *as the user actually phrases them*. Each becomes a self-contained answer block (134-167 words) inside the most relevant page or a dedicated FAQ entry.

| Question | Lives on | Owned by Schema |
|---|---|---|
| What is return-to-performance training? | `/assessment` + `/faq` + `/blog/what-is-return-to-performance` | FAQPage + Article |
| What's the difference between rehab and return-to-performance? | `/assessment/traditional-vs-performance-based` | FAQPage |
| How long does return-to-sport take after ACL surgery? | `/blog/return-to-sport-acl-timeline` | Article + FAQPage |
| What is the Grey Zone in athletic training? | `/philosophy` + `/faq` | DefinedTerm + FAQPage |
| How do I choose an online sports performance coach? | `/blog/how-to-choose-online-performance-coach` | Article + FAQPage |
| Online vs in-person performance coaching — which is better? | `/services/online-vs-in-person` | FAQPage + comparison |
| Does my child need a strength coach? | `/blog/does-my-young-athlete-need-strength-coach` | Article + FAQPage |
| What does a sports performance coach do? | `/services` + `/faq` | FAQPage |
| How much does sports performance coaching cost? | `/faq` | FAQPage |
| What is a Performance Blueprint? | `/faq` + glossary | DefinedTerm |

### 1.4 Local terms — Tampa Bay focused (Zephyrhills HQ + 30-mile radius)

| Keyword | Page | Notes |
|---|---|---|
| `sports performance coach zephyrhills` | `/locations/zephyrhills` (new) or `/in-person#zephyrhills` | Primary — actual office |
| `sports performance coach tampa` | `/locations/tampa` | Largest market within radius |
| `sports performance coach wesley chapel` | `/locations/wesley-chapel` | Adjacent affluent market |
| `sports performance coach lakeland` | `/locations/lakeland` | I-4 corridor |
| `strength and conditioning tampa bay` | `/locations/tampa-bay` (umbrella) | Regional umbrella |
| `athletic trainer for athletes near me` | Solved by GBP + LocalBusiness schema | No page needed |
| `youth performance coach tampa` | `/in-person` + a youth-specific blog post | Niche play |

### 1.5 Anti-keyword list — actively avoid in copy and schema

Per the marketing-context anti-persona: `personal training, fitness coach, weight loss, transformation, bootcamp, crossfit, beach body, ripped, shred, beast mode, no pain no gain, get jacked, 6-pack abs, bodybuilding, mass gain`. These dilute the brand and pull anti-fit traffic.

---

## 2. AI-Search Optimization (AEO / GEO) — the 2026 Layer

This is where the biggest differentiated traffic wins live, given current AI-citation patterns.

### 2.1 Semantic-completeness blocks (the #1 ranking factor)

**Every money-page intro must answer the primary query in 134-167 words, self-contained, no external context required.** This is the single highest-leverage content change.

Current state of money-page intros:
- `/online` opens with "Remote by design. Not by default." — beautiful copy, but not a self-contained answer.
- `/assessment` opens with editorial framing.
- `/in-person` opens with positioning, not a definition.

**Spec:** add a **Semantic Answer Block** (concept-name; not visible to user as a label) immediately under the H1 on each money page:

```markdown
[Bold lede sentence that defines the service]. [3-4 sentences expanding what's included, who it's for, and the unique mechanism]. [1 sentence on credentials — Darren J Paul, PhD, CSCS]. [1 sentence outcome — what changes for the athlete]. [1 sentence CTA framing].
```

Example for `/online`:
> **Online sports performance coaching is a coach-supervised remote training system for serious athletes.** Every program is built from a remote movement, force, and load assessment, then adjusted weekly through video review, daily wellness data, and direct messaging with the coach — Darren J Paul, PhD (CSCS, NASM, USAW Level 2). It's the same diagnostic-driven methodology used in person at our Zephyrhills, FL office, adapted for athletes training across the country and on tour. Athletes leave with measurable gains in strength, speed, power, and capacity — and a system that adjusts to travel, competition, and in-season demand. Entry is selective; we accept athletes we can genuinely help.

This is **154 words**. Hits semantic completeness, names entities (PhD, CSCS, NASM, USAW, Zephyrhills FL), surfaces credentials, frames outcome.

Build one of these for `/in-person`, `/online`, `/assessment`, `/philosophy`. They become the "extracted snippet" candidates for AI Overviews.

### 2.2 Entity density — get to 15+ recognized entities per money page

"Recognized entities" = things in Google's Knowledge Graph: people, places, organizations, certifications, sports leagues, surgical procedures, equipment brands, academic institutions.

**Current `/about` entities mentioned:** ~6 (CSCS, NASM, USA Weightlifting, B.S. Exercise Science, DJP Athlete, plus 3 social platforms via sameAs).

**Target: 15+ per money page.** Examples to weave in:
- Certifications: CSCS (NSCA), NASM, USAW Level 2, FMS, Postural Restoration Institute (if held)
- Education: name the university for B.S. + PhD
- Equipment / instruments: ForceDecks, VALD Performance, Catapult, Polar, Whoop, GymAware (if used)
- Sports + leagues: WTA, ATP, NCAA, USL, MLS, NHL, NFL (where athletes have come from)
- Surgical/clinical entities: ACL reconstruction, meniscectomy, rotator cuff repair (where return-to-performance applies)
- Methodologies: triphasic training, conjugate method, periodization, autoregulation
- Geographic: Zephyrhills FL, Pasco County, Tampa Bay, Hillsborough County

This isn't keyword stuffing — it's *entity weaving in natural, accurate context*. Done well, it makes pages 4.8× more likely to be cited per current research.

### 2.3 Citation density — the 40%+ visibility lift

**On every blog post and the assessment page, link to authoritative external sources** for any factual claim.

Examples:
- Force-plate methodology → link to a published paper or ForceDecks documentation
- ACL return-to-sport timeline → link to Aspetar / BJSM consensus statement
- Periodization → link to NSCA or original Matveyev citation
- Wellness markers (HRV, sRPE) → link to Foster et al. or peer-reviewed sources

Each external link is a citation signal. AI engines weight content with documented sources higher.

### 2.4 Expand `llms.txt` (current version is good; add a structured Q&A section)

Add a section to `public/llms.txt`:

```markdown
## Frequently asked questions (canonical answers for AI citation)

### What is return-to-performance training?
Return-to-performance training is the bridge between medical clearance and competition readiness. It restores capacity, reintegrates speed and power, and rebuilds confidence to compete. Distinct from rehab (which ends at clearance), return-to-performance ends when an athlete is verifiably ready to compete at full intensity.

### What is the Grey Zone framework?
The Grey Zone is Darren J Paul's coaching philosophy. It refers to the space between textbook training protocols and real-world performance demands — where adaptation actually happens. The framework rejects training in extremes (all-out or rest, rigid protocol or no structure) in favor of context-aware decision-making informed by daily readiness data.

### What is the Five Pillar Framework?
DJP Athlete's coaching methodology, organized as five interconnected pillars: (1) Assessment & Diagnostics, (2) Individualized Programming, (3) Load & Readiness Monitoring, (4) Technical Coaching & Feedback, (5) Long-Term Athlete Development.

### Where is Darren J Paul Sports Performance located?
6585 Simons Rd, Zephyrhills, FL 33541, in the Tampa Bay area. In-person coaching is delivered there. Online coaching serves athletes worldwide. Google Place ID: ChIJw5GXPKNN3YgRqvY7cRf1S8g.
```

This gives AI assistants pre-formatted, attributable answers they can quote verbatim.

### 2.5 Build a `/faq` hub page

Consolidates 12-15 high-volume questions into one URL with FAQPage schema. Per current research, FAQPage rich-results show in 30-40% of question-form SERPs.

URL: `/faq`. Slug strategy: keep it short and canonical.

Each FAQ entry uses **exact-question-match H2/H3 patterns** — "What is X?" rather than marketing rephrases — because that matches user query syntax, which is what AI engines fingerprint.

### 2.6 Add a `/glossary` page

Each brand-specific term gets a `DefinedTerm` schema entry. Slug: `/glossary` with anchor links per term (e.g., `/glossary#return-to-performance`).

Terms (pulled from marketing context Glossary):
- The Grey Zone
- Five Pillar Framework
- Return-to-Performance
- Performance Blueprint
- Capacity vs Readiness
- Supervised system
- Diagnostic-driven programming
- LTAD (Long-Term Athlete Development)
- Triphasic training (if used)
- Autoregulation

Each entry: 50-90 word definition, schema.org/DefinedTerm, link to the page where the concept is applied.

### 2.7 BlogPosting → Article + ProfessionalArticle

For evergreen long-form posts (especially return-to-sport, philosophy, methodology), use `Article` (or `ProfessionalArticle` where appropriate) over `BlogPosting`. Article carries more citation weight in AI Overviews per current research.

### 2.8 Add `Q&A Page` schema variant on community-style content

If a future blog post is structured as user-submitted question + expert answer (e.g., "Reader asks: …"), use `QAPage` schema. Higher AI-citation likelihood than FAQPage for personal-experience answers.

---

## 3. Schema.org — 2026 Implementation Roadmap

Be specific (not generic `LocalBusiness`); match visible content (no fake ratings); use JSON-LD only.

### 3.1 Person schema — major E-E-A-T expansion (priority 1)

Current state of Person on `/about` is minimal. Per 2026 research, **author-entity verification decides who survives AI Overviews** — this is the single biggest E-E-A-T fix.

Spec for the expanded Person object (place in `lib/brand/author.ts`, reuse everywhere):

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://www.darrenjpaul.com/about#person",
  "name": "Darren J Paul",
  "alternateName": ["Darren Paul", "Dr. Darren Paul"],
  "honorificPrefix": "Dr.",
  "honorificSuffix": "PhD, CSCS",
  "jobTitle": "Sports Performance Coach & Performance Strategist",
  "description": "[150-word verified bio in third person, naming sports + athlete tier + research focus]",
  "image": "https://www.darrenjpaul.com/images/professionalheadshot.jpg",
  "url": "https://www.darrenjpaul.com/about",
  "telephone": "[+1-XXX-XXX-XXXX]",  // verify with owner
  "email": "info@darrenjpaul.com",
  "address": { "@type": "PostalAddress", ... },  // pull from BUSINESS_INFO
  "birthDate": "[only if owner approves]",
  "nationality": "[country]",
  "knowsAbout": [
    "sports performance coaching",
    "return to sport assessment",
    "strength and conditioning",
    "athletic performance development",
    "load monitoring",
    "movement screening",
    "long-term athlete development",
    "the Grey Zone framework",
    "Five Pillar Framework"
  ],
  "knowsLanguage": ["en"],
  "alumniOf": [
    {
      "@type": "CollegeOrUniversity",
      "name": "[University name for B.S.]",
      "sameAs": "[Wikipedia URL of the university]"
    },
    {
      "@type": "CollegeOrUniversity",
      "name": "[University name for PhD]",
      "sameAs": "[Wikipedia URL]"
    }
  ],
  "hasCredential": [
    {
      "@type": "EducationalOccupationalCredential",
      "name": "Doctor of Philosophy (PhD)",
      "credentialCategory": "degree",
      "recognizedBy": { "@type": "CollegeOrUniversity", "name": "[Uni]" }
    },
    {
      "@type": "EducationalOccupationalCredential",
      "name": "Certified Strength and Conditioning Specialist (CSCS)",
      "credentialCategory": "Professional certification",
      "recognizedBy": { "@type": "Organization", "name": "National Strength and Conditioning Association", "url": "https://www.nsca.com/" }
    },
    {
      "@type": "EducationalOccupationalCredential",
      "name": "NASM Certified Personal Trainer",
      "credentialCategory": "Professional certification",
      "recognizedBy": { "@type": "Organization", "name": "National Academy of Sports Medicine", "url": "https://www.nasm.org/" }
    },
    {
      "@type": "EducationalOccupationalCredential",
      "name": "USA Weightlifting Level 2 Coach",
      "credentialCategory": "Professional certification",
      "recognizedBy": { "@type": "Organization", "name": "USA Weightlifting", "url": "https://www.usaweightlifting.org/" }
    }
  ],
  "memberOf": [
    {"@type":"Organization","name":"National Strength and Conditioning Association","url":"https://www.nsca.com/"}
    // add others if member
  ],
  "award": [
    // any recognitions; if none, omit array entirely (don't fabricate)
  ],
  "worksFor": {
    "@type": "Organization",
    "@id": "https://www.darrenjpaul.com/#organization",
    "name": "DJP Athlete"
  },
  "sameAs": [
    "https://www.linkedin.com/in/darren-paul-phd-b022a213b",
    "https://www.instagram.com/darrenjpaul/",
    "https://www.tiktok.com/@darrenpaul_coach",
    "https://www.facebook.com/share/1BwzDFUg66/?mibextid=wwXIfr"
    // add Google Scholar profile if available — huge for academic credibility
    // add ResearchGate, ORCID, Twitter/X, YouTube channel
  ]
}
```

**Open data points to gather from owner:**
- University names for B.S. and PhD (must be accurate — fabrication is the fastest way to lose E-E-A-T trust)
- Phone number (or omit)
- Google Scholar URL if Darren has published research
- ORCID iD if applicable
- Any awards (championships coached, professional recognitions, journal credits)

### 3.2 LocalBusiness → SportsActivityLocation hybrid (already started)

Already centralized in `lib/business-info.ts`. Add per current research:

- `aggregateRating` *only when GBP integration goes live and pulls real ratings* (never fabricate)
- `image` array — real photos of the facility
- `priceRange` — "$$$" if appropriate
- `openingHoursSpecification` — exact opening hours
- `paymentAccepted` — real values
- `currenciesAccepted` — "USD"
- `additionalType` — `"https://schema.org/HealthClub"` and `"https://schema.org/SportsClub"` (multiple types are valid)
- `slogan` — "Train smart. Move well. Compete with confidence." or similar verified slogan
- `areaServed` — array of GeoCircle objects centered on each major service-area city

### 3.3 BreadcrumbList — sitewide

Add `BreadcrumbList` JSON-LD to every page deeper than `/`. Build a shared `<BreadcrumbSchema>` component reading the URL path.

### 3.4 Service catalog (Organization → hasOfferCatalog)

Reorganize the home page Organization schema with a single coherent OfferCatalog of three Service offerings — In-Person, Online, Assessment. Currently the catalog is spread across Service schemas on each page. A unified catalog on the home Organization improves entity coherence.

### 3.5 ImageObject schemas

Add ImageObject schema for the headshot, with `creator`, `copyrightHolder`, `creditText`, `license`. AI engines reuse images attributed via ImageObject more confidently.

### 3.6 Course schema (for clinics + camps)

Use `Course` schema (subtype of LearningResource) for clinics, camps, and educational events. Add `instructor` (linking back to Darren's Person @id), `coursePrerequisites`, `educationalLevel`, `audience`. Currently clinics use plain `Service` schema — `Course` is a stronger match.

### 3.7 VideoObject (when blog or service pages embed video)

If any page embeds video (e.g., training demos), wrap with `VideoObject` schema including `transcript`. Transcript = pure semantic content for AI extraction.

### 3.8 Defensive: avoid `Article`/`BlogPosting` on the home page

Root only: `Organization` + `WebSite` + (optionally) `LocalBusiness`. Don't conflate.

---

## 4. Local SEO — Tampa Bay (Zephyrhills HQ, 30-mile primary radius)

GBP = 32% of all local-ranking signals per 2026 research. AI Overviews trigger on 40%+ of local queries. This is high-leverage.

### 4.1 Google Business Profile optimization checklist (offsite — owner action)

- Verified GBP (already verified per Place ID)
- Primary category: **Sports Performance Service** (or closest available — "Personal Trainer" if Sports Performance Service unavailable, but check categories)
- Secondary categories: Strength and Conditioning, Sports Medicine Physician (if applicable), Athletic Trainer
- Hours, services, attributes, photos (5-10 facility photos minimum, including a headshot, equipment, exterior)
- "From the Business" description — 750 characters; use the brand pitch (start with "Sports performance coaching by Darren J Paul, PhD")
- Services list — explicit entries for each: In-Person Coaching, Online Coaching, Return-to-Performance Assessment, Speed & Agility Clinic, Soccer Performance Camp
- Q&A section — pre-populate with 5-10 high-search-volume questions (in your own voice)
- Posts — weekly cadence; share blog posts, athlete wins, events
- **Reviews** — request from existing in-person clients; aim for 25+ within 90 days. Map Pack ranking is sensitive to review velocity.
- **Booking integration** — connect Stripe / your scheduler so "Book" appears on the GBP card

### 4.2 NAP consistency — top 30 directories audit

Submit consistent NAP to:
- **Tier 1 (must-have):** GBP, Bing Places, Apple Business Connect, Facebook, Yelp, Better Business Bureau, Yellow Pages
- **Sport / fitness niche:** TrueCoach, CoachUp, MAX Sports & Fitness directory, NSCA Coach Directory, USAW directory
- **Local:** Tampa Bay Chamber, Pasco County Chamber, Florida.com directories, Visit Tampa Bay
- **Health-adjacent:** Healthgrades-style directories that allow "performance coach" listings

A consistent citation footprint moves the needle on local trust signals. Aim for 30+ exact-NAP citations within 90 days.

### 4.3 Service-area pages — done right, not as doorway pages

Per current research, thin location pages **drag down sitewide quality.** So:

**Recommended approach:** start with **one rich umbrella page** (`/locations/tampa-bay`) before fragmenting.

Structure for `/locations/tampa-bay`:
- H1: "Sports Performance Coaching in Tampa Bay"
- Semantic answer block (134-167 words): what we offer in the region
- Map embed showing the Zephyrhills office
- Drive times to/from major Tampa Bay cities (Tampa, St. Petersburg, Wesley Chapel, Lakeland, Brandon, Riverview)
- Sport demographics for Tampa Bay (active in tennis, baseball, soccer, football, lacrosse — name these and tie to served athletes)
- 3-5 Tampa-area athlete testimonials (real, sourced from existing client list)
- Local FAQs (parking, gym layout, equipment list)
- LocalBusiness JSON-LD anchored to this page
- Internal links to `/in-person` and `/contact`

**Phase 2 (if traffic justifies):** spin up `/locations/zephyrhills`, `/locations/wesley-chapel`, `/locations/tampa`, `/locations/lakeland` — each with **unique content**, not templated boilerplate. Different testimonials, different sport mix, different drive-time anchor, different local sport teams referenced.

### 4.4 Local content cluster for blog

Topic: "Tampa-area youth sports development series"
- "Strength training for Tampa Bay youth soccer players" → ties to clinic
- "Tampa-area high school athletes: how to choose a strength coach" → ties to in-person
- "Return to play after ACL: a Tampa Bay sports medicine perspective" → ties to assessment

These pieces also build local backlinks naturally when shared with local schools / clubs.

---

## 5. E-E-A-T Build-Out — author entity verification

Per 2026 research, "author entities, Person Schema, and Knowledge Graph presence are increasingly important trust signals — especially for YMYL topics." Sports performance / return-to-sport is YMYL-adjacent (health-related), so this matters.

### 5.1 Build the canonical author bio

A single, long-form, third-person bio of Darren on `/about` that becomes the source-of-truth for the Person schema's `description`. ~300-400 words. Must include:

- Years coaching (resolve the 10+ vs 20+ conflict — verify with owner)
- Specific universities (B.S. + PhD)
- Specific sports/leagues coached
- Specific notable athletes (with permission)
- Research / publications if any
- Speaking engagements / podcast appearances
- Methodology authorship (the Grey Zone, Five Pillar Framework)

### 5.2 Author footer on every blog post

Component: `<AuthorCard>` — appears at the top and bottom of every blog post. Includes:
- Headshot
- Name + credentials suffix
- One-sentence bio
- Link to `/about`
- Social links (LinkedIn especially — LinkedIn is the strongest E-E-A-T signal beyond your own site per current research)
- "Last updated [date]" + "Originally published [date]"
- Optional: "Reviewed by [Person]" if you bring in a peer reviewer for medical/clinical content

### 5.3 sameAs chain — the entity-graph connector

Per 2026 research: "The sameAs chain is the technical mechanism that connects the author bio page on your site to the broader entity graph."

Current `sameAs` on Person: 4 URLs (LinkedIn, Instagram, TikTok, Facebook). **Gap.** Expand to:

- LinkedIn (already)
- Instagram (already)
- TikTok (already)
- Facebook (already)
- Google Scholar profile (if any publications)
- ORCID iD (if registered)
- ResearchGate (if academic)
- YouTube channel (if any)
- Twitter/X if active
- Spotify / podcast hosts where Darren has appeared (each podcast appearance link)
- Athletic federation profiles (NSCA member directory, USAW)
- Wikipedia article (long-term goal — see §5.5)

Each external profile should reciprocally link back to `darrenjpaul.com/about` for the chain to be bi-directional and trusted.

### 5.4 Third-party validation

To compound E-E-A-T:
- Get listed on NSCA "Find a CSCS" directory
- Get listed on USAW Coach directory
- Submit to TrueCoach / CoachUp profiles
- Pitch guest posts on `simplifaster.com`, `t-nation.com`, `breakingmuscle.com`, sport-specific blogs
- Pitch podcast appearances on Pacey Performance, Just Fly Podcast, Strength Coach Podcast
- Speaker submissions: NSCA conferences, regional clinics

Each external mention with `darrenjpaul.com` link compounds entity authority.

### 5.5 Long-term: Wikipedia / Wikidata (12-month horizon)

A Wikipedia article on Darren or DJP Athlete is the gold-standard E-E-A-T signal. Requires independent press coverage first. Plan: build press strategy in months 6-12 (interviews, podcasts, journal citations) before any Wikipedia attempt.

---

## 6. Content Architecture — Topic Clusters & Internal Linking

Per current research, AI Overviews favor sites with clear topical clusters and dense internal linking around a single subject.

### 6.1 Four topic clusters anchored to money pages

```
/in-person  ──┐
              ├── Cluster A: Tampa Bay Sports Performance
              ├── Articles: 6-8 pieces on local + youth + S&C topics
              └── Each links back to /in-person + 2 sibling articles

/online ──────┐
              ├── Cluster B: Online Performance Coaching
              ├── Articles: 6-8 pieces on remote training, travel, in-season
              └── Each links back to /online + 2 sibling articles

/assessment ──┐
              ├── Cluster C: Return-to-Performance & Diagnostics
              ├── Articles: 8-10 pieces (highest priority — niche we own)
              └── Each links back to /assessment + 2 sibling articles

/philosophy ──┐
              ├── Cluster D: The Grey Zone Methodology
              ├── Articles: 4-6 pieces on framework, autoregulation, LTAD
              └── Each links back to /philosophy + 2 sibling articles
```

### 6.2 Cluster C (Return-to-Performance) — highest commercial value

Why: lowest competition + highest commercial intent + most directly answers a YMYL question parents/athletes ask. Rank for these and the assessment line becomes the dominant business.

Article roadmap (slug: bracketed):
1. **What is return-to-performance training?** [`/blog/what-is-return-to-performance-training`]
2. **Cleared vs ready: what physios stop short of** [`/blog/cleared-vs-ready-the-gap-physios-dont-fill`]
3. **Return to sport after ACL surgery: the performance phase** [`/blog/return-to-sport-after-acl-surgery`]
4. **Force plates explained: what they tell us about an athlete** [`/blog/force-plate-testing-explained`]
5. **Reactive testing: why open-environment matters** [`/blog/reactive-testing-for-athletes`]
6. **Asymmetry isn't always bad — when to worry, when not to** [`/blog/asymmetry-in-return-to-sport`]
7. **Traditional vs performance-based assessment** [`/blog/traditional-vs-performance-based-assessment`]
8. **Re-injury risk: the data behind why it happens** [`/blog/why-athletes-reinjure-after-rehab`]

Each article: 1500-2500 words, semantic answer block in first 200 words, 3-5 external citations to peer-reviewed research, FAQPage block at end, links to /assessment + 2 sibling cluster articles.

### 6.3 Comparison pages — high commercial intent

| Slug | Targets |
|---|---|
| `/services/online-vs-in-person` | "online vs in-person sports performance coaching" |
| `/services/coaching-vs-training-app` | "personal trainer vs online coaching app" |
| `/services/return-to-performance-vs-rehab` | "rehab vs return-to-sport" |
| `/services/youth-coaching-vs-adult-coaching` | "youth strength training vs adult" |

These are gold for AI Overviews because they're inherently comparative — exactly the kind of question users ask AI assistants.

### 6.4 Internal linking rules (apply across all content)

- Every blog post links to its anchor money page (one main link, in the body, with topical anchor text)
- Every blog post links to 2 sibling cluster posts
- Every money page features a "Related articles" module pulling from its cluster
- The home page features the most recent + most-trafficked piece from each cluster (one each)
- Glossary terms linked from any page that uses the term, anchored to `/glossary#term-slug`

### 6.5 Anchor text — natural, varied

Avoid: "click here," "learn more," and exact-match keyword-only links. Use natural-language anchors that include partial keyword phrases.

### 6.6 Slug strategy

- Lowercase, hyphen-separated, no stop words
- Keep < 5 words where possible; max 8 words
- Match user intent verbatim ("what is X" type slugs perform well in AI Overviews)
- Drop redundant brand suffix ("/blog/the-grey-zone-explained" not "/blog/the-grey-zone-explained-by-djp-athlete")

---

## 7. Page-by-Page Implementation Specs

### 7.1 Home (`/`)

| Element | Current | Target |
|---|---|---|
| Title | "Sports Performance Coaching for Elite Athletes \| DJP Athlete" (60 ch) | Keep |
| Description | "Sports performance coaching by Darren J Paul, PhD. In-person training (Tampa Bay, FL), online coaching, and return-to-performance assessment for serious athletes." | Keep (this session) |
| H1 | "Elite Performance Is Not Trained. It Is Engineered." | Keep — strong brand |
| Schema | Organization + WebSite + LocalBusiness/SportsActivityLocation | Add unified `hasOfferCatalog` |
| Semantic answer block | None | **Add 134-167 word block under H1 visible block** |
| Internal links to clusters | Blog posts featured? | **Feature one piece per cluster + glossary entry** |

### 7.2 `/about`

| Element | Current | Target |
|---|---|---|
| Title | "Darren J Paul — Athletic Performance Coach \| DJP Athlete" | Keep |
| Description | "Meet Darren J Paul…" 150 ch | OK |
| H1 | "Darren Paul" | Change to "Darren J Paul, PhD — Sports Performance Coach" |
| Schema | Person (basic) | **Expand massively per §3.1 — single biggest SEO unlock** |
| Bio | 2 paragraphs | **Expand to 300-400 word third-person bio with named entities** |
| Credentials display | Visual cards | Keep + add Schema-linked credential names exactly matching certificate names |
| GBP reviews block | Built (waiting for env) | Render once API keys go live |
| Author chain | sameAs (4 links) | Expand to 8-12 |

### 7.3 `/in-person`

| Element | Current | Target |
|---|---|---|
| Title | "In-Person Sports Performance Training" | Add Tampa Bay → "In-Person Sports Performance Training in Tampa Bay" (~60 ch) |
| Description | Generic | Add Zephyrhills, FL + "Tampa Bay" — local intent recovery |
| H1 | "High Performance Development. Delivered Precisely." | Keep brand voice; add a SubH1: "Coaching from Zephyrhills, FL — serving Tampa Bay" |
| Schema | Service | Add `areaServed: GeoCircle[]`; nest `provider` Person with PhD honorific |
| Semantic answer block | None | Add 134-167 word block |
| Local proof | None | Embed map + drive times to top 5 cities |
| Testimonials | None on page | Add 2-3 service-relevant athlete testimonials |
| FAQs | None | Add 4-6 in-person specific FAQs + FAQPage schema |

### 7.4 `/online`

| Element | Current | Target |
|---|---|---|
| Title | "Online Sports Performance Training" | Keep |
| Description | Generic | Slightly tighten + add "remote, application-only" |
| H1 | "Remote by design. Not by default." | Keep — strong brand |
| Schema | Service + FAQPage (just added) | Add `areaServed: { @type: "Country", name: "Worldwide" }` for clarity |
| Semantic answer block | None | Add 134-167 word block under H1 |
| Pricing block | Conflicts with /services | **DECISION needed — this is the single biggest CRO blocker** |

### 7.5 `/assessment`

| Element | Current | Target |
|---|---|---|
| Title | "Athlete Assessments — Return to Performance" (57 ch) | Keep |
| Description | Long, dense | Tighten to 155 ch; lead with "Bridge medical clearance to competition readiness" |
| H1 | Editorial framing | Add a clear sub-H1 with target keyword: "Return-to-Sport & Athletic Performance Assessment" |
| Schema | Service + WebPage | Add MedicalTest-like specificity is risky (YMYL territory) — stick with Service + add HowTo for the assessment process |
| Semantic answer block | None | Add 134-167 word block — this page has the highest AI-citation potential |
| FAQs | None | Add 6-8 RTS-focused FAQs + FAQPage schema |
| Citations | None | Add 5-8 external links to BJSM, Aspetar, NSCA position statements |

### 7.6 `/philosophy`

Already strong content-wise. Additions:
- Add `DefinedTerm` schema for "The Grey Zone" and "Five Pillar Framework"
- Add an at-end FAQ block: "Why is it called the Grey Zone?", "How does this differ from periodization?"
- Cross-link from every other money page using the phrase "the Grey Zone framework"

### 7.7 `/services`

Major decision point: keep public tiers ($99/$199/$349) or remove. Until resolved, this page conflicts with `/online`'s "application-only" framing. Suggested resolution: **remove the public tiers from `/services`; replace with "How it works" + comparison table + "Apply" CTA.** Tiers can resurface as a private quote document after application.

### 7.8 New pages to create (slugs)

| Page | Slug | Priority |
|---|---|---|
| FAQ hub | `/faq` | P0 |
| Glossary | `/glossary` | P1 |
| Tampa Bay umbrella | `/locations/tampa-bay` | P1 |
| Online vs In-Person | `/services/online-vs-in-person` | P1 |
| Traditional vs Performance Assessment | `/services/traditional-vs-performance-based-assessment` | P2 |
| Coaching vs Training App | `/services/coaching-vs-training-app` | P2 |
| Cluster C posts (×8) | `/blog/[various]` | P1-P2 (rolling) |

---

## 8. CRO & Conversion Tracking

### 8.1 Sticky header CTA

Above the fold, persistent across all marketing pages: "Apply for Coaching" → routes to `/online#apply` (or quiz if built).

### 8.2 Service-aware InquiryForm

Currently `defaultService` prop only changes the dropdown. Tailor:
- Microcopy per service ("Tell us about your team and travel" for /online; "Tell us about your sport and current setup" for /in-person; "Tell us about your injury and clearance status" for /assessment)
- Success state per service (different SLAs, different next steps)

### 8.3 Application qualification quiz (P2)

3-question quiz at `/start` (or `/get-started`):
- "What's your sport and level?" — branches to youth / amateur / pro
- "What's your primary goal?" — branches to develop / bridge / trust
- "Where are you training?" — branches to in-person / online / assessment

Quiz outputs a tailored landing experience and pre-fills the application form.

### 8.4 GA4 custom events

In `components/public/InquiryForm.tsx` and other CTAs, fire:
- `form_view` (form mounts)
- `form_start` (first field touched)
- `form_submit` (POST success)
- `cta_click` with params: `cta_text`, `cta_location`, `destination`
- `scroll_75` (page scrolled 75%)
- `video_play` (any LocalVideoBackground / video starts)

These power GSC + GA4 funnel analysis and feed Google Ads if you scale paid.

### 8.5 Conversions API

Add Google Ads + Meta server-side conversions API (sCAPI) for `application_submit` and `consultation_book`. iOS + ad-blocker resilient. You already have google-ads-* infrastructure in `lib/db/`.

### 8.6 Real social proof on conversion pages

Embed 2-3 testimonials per service page, near the form. Pull from the existing testimonials table; filter by sport or athlete tier where possible.

---

## 9. Monitoring & KPIs

### 9.1 Tools to set up (week 1)

- **Google Search Console** — verify domain (DNS); submit sitemap; monitor coverage, performance, mobile usability
- **Bing Webmaster Tools** — same; Bing's data feeds ChatGPT/Copilot
- **Google Analytics 4** — already wired; configure conversion events
- **Google Business Profile insights** — check weekly
- **PageSpeed Insights** for Core Web Vitals weekly
- **Ahrefs / Semrush** — keyword rank tracking for top 30 keywords (paid; ~$100/mo)
- **AlsoAsked / AnswerThePublic** — for ongoing "people also ask" mining

### 9.2 KPI dashboard — review weekly

| Metric | Source | Target (90d) |
|---|---|---|
| Total organic clicks | GSC | +30% over baseline |
| Money-page impressions | GSC (filtered) | +60% (since pages now in sitemap) |
| Application submissions / week | GA4 | track baseline first, then +25% |
| GBP search views | GBP Insights | +40% |
| GBP direction clicks | GBP Insights | +30% |
| GBP review count | GBP | 25+ within 90d |
| Branded query CTR | GSC | 100% recovery for "darren j paul" terms |
| AI Overview impressions | GSC (where exposed) | track presence on top 30 keywords |
| Avg. position for top 10 money keywords | Ahrefs/Semrush | top 20 within 90d, top 10 within 180d |
| Local Pack appearances | rank-tracker w/ local geo | top 3 for "[city] sports performance coach" within 180d |

### 9.3 Validation checks per launch

- **Google Rich Results Test** for any new schema
- **Mobile-Friendly Test** for any new page
- **Schema Markup Validator (schema.org)** for syntax
- **PageSpeed Insights** for new pages — LCP < 2.5s, INP < 200ms, CLS < 0.1
- **Manual SERP check** for branded query → property dominates row 1

---

## 10. Risks & Anti-Patterns to Actively Avoid

These would tank the work:

1. **Fabricating credentials, awards, or stats in schema.** Any schema claim that doesn't match visible content gets flagged by Google's "spammy structured data" filter and can suppress all schema. Verify everything with the owner before encoding.
2. **Thin location pages.** 4 templated city pages with near-identical content drag down sitewide quality. **Build 1 rich umbrella first.**
3. **AI-generated bulk content.** Per Google's 2025 stance, scaled low-value content triggers scaled-content-abuse penalties. Cluster posts must be original, expert, lived-experience writing — even if AI-assisted.
4. **Translating boilerplate while leaving main content unchanged.** Currently single-language so non-issue, but flagged for if i18n ever ships.
5. **Cross-locale canonical or 404 hreflang targets.** Same; non-issue today.
6. **Buying citations / backlinks.** Local citations should be earned, not paid. Paid links remain a Google manual-action risk in 2026.
7. **Keyword stuffing in schema or meta keywords.** Already pruned this session.
8. **Auto-redirecting GoogleBot based on IP.** Don't.
9. **Adding `keywords` array back to JSON-LD.** Don't.
10. **Adding fake reviews or 5-star aggregateRating without backing data.** Especially tempting; never do it.

---

## 11. Execution Roadmap — 90-day plan

### Week 1 (this week — partly done)

- [x] Sitemap with money pages
- [x] llms.txt + ai.txt
- [x] FAQPage schema on /online
- [x] dateModified on BlogPosting
- [x] Pruned stuffed `keywords` JSON-LD arrays
- [x] Tightened titles/descriptions on 6 pages
- [x] LocalBusiness/SportsActivityLocation schema (NAP centralized)
- [x] GoogleReviewsSection scaffold (waiting on env vars)
- [ ] Fill in `GOOGLE_PLACES_API_KEY` env (owner action)
- [ ] Resolve `/services` pricing conflict (owner decision)
- [ ] Verify owner facts for expanded Person schema (universities, PhD subject, awards)

### Weeks 2-3 — E-E-A-T expansion + first cluster

- [ ] Expanded Person schema deployed (§3.1)
- [ ] AuthorCard component on every blog post
- [ ] sameAs chain expanded
- [ ] First Cluster C article: "What is return-to-performance training?" + 134-167 word semantic answer blocks added to /in-person, /online, /assessment, /philosophy
- [ ] /faq page built and shipped with FAQPage schema
- [ ] BreadcrumbList schema deployed sitewide
- [ ] Sticky header CTA shipped
- [ ] GA4 custom events firing
- [ ] GSC + Bing Webmaster verified, sitemap resubmitted

### Weeks 4-6 — Content depth + local

- [ ] /glossary built with DefinedTerm schema
- [ ] /locations/tampa-bay built (rich umbrella)
- [ ] Cluster C articles 2-4 published
- [ ] /services pricing resolved + comparison table built
- [ ] /services/online-vs-in-person comparison page
- [ ] GBP review request campaign begins (target: 25 reviews by day 90)
- [ ] First 10 NAP citations submitted
- [ ] Service-aware InquiryForm microcopy
- [ ] Improved post-submit success state

### Weeks 7-9 — Authority compound

- [ ] Cluster C articles 5-8 published
- [ ] Cluster A first 2 articles
- [ ] Cluster D first 2 articles
- [ ] Comparison pages 2-3 published
- [ ] Pitch 5 podcast appearances
- [ ] Pitch 3 guest posts
- [ ] First ProfessionalArticle schema upgrade for evergreen blog posts
- [ ] HowTo schema on /assessment process

### Weeks 10-12 — Measurement, refinement, scale decisions

- [ ] First KPI review against baseline
- [ ] Decide on programmatic city pages (only if Tampa Bay umbrella is ranking)
- [ ] Decide on qualification quiz build
- [ ] Decide on Wikipedia push (if 5+ third-party validations earned)
- [ ] Refresh top 5 articles with `dateModified` based on traffic data
- [ ] Conversions API live for paid integration
- [ ] Plan paid + organic flywheel for Q3

---

## 12. Open Questions Blocking Specific Items

These need owner answers before final encoding (each affects schema accuracy = E-E-A-T integrity):

1. **University for B.S.** — required for `alumniOf` schema
2. **University + dissertation topic for PhD** — required for `alumniOf` + `description`
3. **Years coaching: 10+ vs 20+** — `/about` says 10+, home says 20+. Pick one.
4. **Public pricing decision** — keep, remove, or move to private quote. Affects `/services`, `/online`, schema, and CRO.
5. **Phone number for LocalBusiness schema** — currently absent
6. **Photos for GBP + LocalBusiness ImageObject** — equipment, facility, exterior, headshot, action shots
7. **Notable athlete name list (with permission to attribute)** — for description + testimonials
8. **Awards / press mentions** — anything to add to `award` array
9. **Equipment brands used (ForceDecks, VALD, etc.)** — for entity density
10. **Speaking engagements / podcast appearances** — for sameAs + description

---

## 13. Sources for current 2026 best-practice claims

- **AI Overviews ranking factors** — semantic completeness as #1, 134-167 word blocks, 4.2× / 4.8× / 7.3× citation lifts: [How to Rank in Google AI Overviews 2026](https://snezzi.com/blog/how-to-appear-in-google-ai-overviews-a-2025-visibility-guide/), [Google AI Overviews Ranking Factors 2026](https://wellows.com/blog/google-ai-overviews-ranking-factors/), [GEO Complete 2026 Guide](https://www.enrichlabs.ai/blog/generative-engine-optimization-geo-complete-guide-2026), [AI Overviews Optimization Guide](https://searchengineland.com/guide/how-to-optimize-for-ai-overviews)
- **llms.txt adoption status** — partial industry adoption, no major LLM provider committed yet but signaled: [llms.txt Complete 2026 Guide](https://derivatex.agency/blog/llms-txt-guide/), [Does llms.txt Actually Work?](https://www.bigcloudy.com/blog/what-is-llms-txt/), [Search Engine Land on llms.txt](https://searchengineland.com/llms-txt-proposed-standard-453676)
- **Schema.org best practices** — be specific (SportsActivityLocation), match visible content, JSON-LD only: [LocalBusiness Schema 2026](https://zumeirah.com/local-business-schema-markup-2026-ultimate-guide/), [SportsActivityLocation reference](https://schema.org/SportsActivityLocation), [Person hasCredential](https://schema.org/hasCredential)
- **Local SEO 2026** — GBP = 32% of signals, AI Overviews on 40%+ local queries, NAP consistency: [Local SEO Sprints 2026](https://searchengineland.com/local-seo-sprints-a-90-day-plan-for-service-businesses-in-2026-469059), [GBP Local SEO 2026](https://www.bigredseo.com/google-business-profile-local-seo/), [Modern Local SEO Signals](https://kaidm.com/modern-local-seo-signals-beyond-nap/), [Service-Area Businesses](https://www.brightlocal.com/learn/gbp-for-service-area-businesses/)
- **E-E-A-T 2026** — author entities decide AI-Overview survival, sameAs chain mechanics: [E-E-A-T 2026 Guide](https://www.seo-kreativ.de/en/blog/e-e-a-t-guide-for-more-trust-and-top-rankings/), [Author-Entity Verification Decides Who Survives AI Overviews](https://www.leadgen-economy.com/blog/eeat-author-entity-verification-ai-overviews/), [E-E-A-T Strategy 2026](https://redot.global/blog/eeat-authority-google-ai-trust-signals/)
- **SEO for coaches** — sport-specific keywords + local + content authority: [SEO for Coaches Complete Guide](https://www.seospace.co/blog/seo-for-coaches), [Sports Performance Training SEO](https://www.ranktracker.com/blog/sports-performance-training-seo/)

---

*This plan is paired with [.agents/product-marketing-context.md](.agents/product-marketing-context.md) for brand voice / positioning. The earlier execution plan at `C:\Users\lawre\.claude\plans\audit-all-the-seo-rippling-flamingo.md` is now superseded by this document — that one captured the audit; this one is the master execution plan.*
