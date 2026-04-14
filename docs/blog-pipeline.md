# DJP Athlete Blog Generation Pipeline

## Overview

This document defines the end-to-end pipeline for generating, reviewing, and publishing blog content for DJP Athlete. It covers prompt templates, pipeline architecture, editorial guidelines, and SEO standards.

---

## Table of Contents

1. [Content Pillars](#content-pillars)
2. [Target Audience](#target-audience)
3. [Pipeline Architecture](#pipeline-architecture)
4. [AI Prompt Templates](#ai-prompt-templates)
5. [Brand Voice & Tone](#brand-voice--tone)
6. [Formatting Standards](#formatting-standards)
7. [SEO Checklist](#seo-checklist)
8. [Editorial Review Process](#editorial-review-process)

---

## Content Pillars

### 1. Sports Performance & Training

- Periodization strategies and programming philosophy
- Sport-specific training (Comeback Code, Rotational Reboot, etc.)
- Strength, power, and conditioning methodologies
- Recovery and load management

### 2. Client Success Stories

- Athlete transformations and case studies
- Before/after programming breakdowns
- Testimonials with training context
- Return-to-sport journeys

### 3. Education & Industry

- Exercise science insights (accessible, not academic)
- Injury prevention and prehab programming
- Nutrition principles for performance
- Coaching philosophy and business tips for trainers

---

## Target Audience

| Segment                | Who They Are                                      | What They Want                                               |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| **Athletes / Clients** | Current and prospective athletes seeking coaching | Actionable training advice, proof of results, trust signals  |
| **Coaches / Trainers** | Fitness professionals looking to level up         | Programming ideas, coaching frameworks, industry perspective |

Write every post so it delivers value to at least one segment, ideally both. Lead with the athlete-facing angle, then layer in coach-level depth.

---

## Pipeline Architecture

```
IDEATION ──> OUTLINE ──> DRAFT ──> REVIEW ──> OPTIMIZE ──> PUBLISH
   │            │           │         │           │            │
   ▼            ▼           ▼         ▼           ▼            ▼
 Topic       Structure   AI-assisted  Human     SEO +        CMS
 research    + key       content     editorial  formatting   upload
 + keyword   points     generation   review     pass         + schedule
 planning
```

### Step 1: Ideation

- Pull from content calendar, trending topics, athlete FAQs, and keyword research
- Map each idea to a content pillar and target audience segment
- Define the primary keyword and 2-3 secondary keywords

### Step 2: Outline

- Create a structured outline with H2/H3 hierarchy
- Identify key points, examples, and any athlete stories to include
- Note internal links to existing content or product pages (Comeback Code, Rotational Reboot)

### Step 3: Draft (AI-Assisted)

- Use the prompt templates below to generate the initial draft
- AI generates the body; human provides the personal stories and unique insights
- Target word count: 800-1500 words (adjust per topic complexity)

### Step 4: Editorial Review

- Human review for accuracy, voice alignment, and authenticity
- Fact-check any claims about training science or physiology
- Ensure personal anecdotes and coaching experience are woven in
- Verify all athlete references have consent for public mention

### Step 5: SEO & Formatting Optimization

- Run through the SEO checklist below
- Apply formatting standards (headings, images, CTAs)
- Add meta description, alt text, and internal links

### Step 6: Publish

- Upload to CMS with proper categories and tags
- Schedule based on content calendar
- Queue social media promotion snippets

---

## AI Prompt Templates

### General Blog Post

```
You are a sports performance content writer for DJP Athlete, a coaching brand
that specializes in return-to-sport programming and rotational athlete
development.

CONTEXT:
- Brand voice: Confident, knowledgeable, approachable. Think "smart coach
  talking to you after a session" — not academic, not bro-science.
- Products: Comeback Code (return-to-sport), Rotational Reboot (rotational
  athletes)
- Audience: Athletes seeking coaching AND coaches looking for programming ideas

TASK:
Write a blog post about: [TOPIC]

Primary keyword: [KEYWORD]
Secondary keywords: [KEYWORD_2], [KEYWORD_3]
Target word count: [WORD_COUNT]
Content pillar: [PILLAR]

REQUIREMENTS:
- Open with a hook that connects to a real training scenario
- Use H2 and H3 subheadings for scannability
- Include 1-2 practical takeaways the reader can apply immediately
- Reference DJP Athlete methodology where natural (don't force it)
- End with a clear CTA (consultation, program link, or related post)
- Avoid: jargon without explanation, generic fitness fluff, clickbait
- Tone: Direct, evidence-informed, coaching-focused
```

### Client Success Story

```
You are writing a client success story for DJP Athlete's blog.

ATHLETE INFO:
- Name/Alias: [NAME]
- Sport: [SPORT]
- Challenge: [WHAT_THEY_CAME_IN_WITH]
- Program: [PROGRAM_USED]
- Outcome: [RESULTS]
- Timeline: [DURATION]

REQUIREMENTS:
- Tell the story in a narrative arc: challenge → approach → transformation
- Include specific programming details that coaches will find valuable
- Keep the athlete's voice central — use their quotes where available
- Highlight what made the DJP approach different
- Include measurable outcomes where possible
- End with what's next for the athlete + CTA for similar clients
- Tone: Celebratory but grounded, never exaggerated
```

### Educational / Science-Based Post

```
You are writing an educational blog post for DJP Athlete that makes sports
science accessible.

TOPIC: [TOPIC]
TARGET AUDIENCE: [ATHLETES / COACHES / BOTH]

REQUIREMENTS:
- Lead with "why this matters" for the reader, not the science
- Break down the concept using real-world training analogies
- Reference research where relevant but don't write like a journal article
- Include a "How to apply this" section with concrete programming examples
- Bridge to DJP Athlete's approach where relevant
- Avoid: oversimplification that loses accuracy, fear-mongering, absolutist
  claims ("you MUST do X")
- Tone: "Here's what the evidence says and how we use it"
```

---

## Brand Voice & Tone

### Voice Attributes

| Do                              | Don't                             |
| ------------------------------- | --------------------------------- |
| Confident and direct            | Arrogant or dismissive            |
| Evidence-informed               | Overly academic or citation-heavy |
| Coaching-focused (practical)    | Generic motivational fluff        |
| Approachable and conversational | Overly casual or slangy           |
| Honest about complexity         | Oversimplified clickbait          |

### Tone by Content Type

- **Training posts:** Authoritative, instructional — "here's how and why"
- **Success stories:** Warm, celebratory, specific — "here's what happened"
- **Educational:** Curious, clear, grounded — "here's what we know"
- **Opinion/industry:** Candid, thoughtful — "here's what I think and why"

### Language Guidelines

- First person ("I" / "we") is encouraged — this is a coaching brand, not a textbook
- Use "athlete" or "client" over "customer"
- Refer to programs by name (Comeback Code, Rotational Reboot) naturally
- Avoid: "gains," "shredded," "beast mode," and generic fitness culture language
- Prefer: "performance," "capacity," "programming," "load management," "return to sport"

---

## Formatting Standards

### Structure

- **Title:** Under 60 characters, includes primary keyword
- **Meta description:** 150-160 characters, includes primary keyword, compelling hook
- **Introduction:** 2-3 sentences max, hook + what the reader will learn
- **Body:** H2 sections for major points, H3 for sub-points
- **Conclusion:** Brief summary + single clear CTA
- **Word count:** 800-1500 words (sweet spot: 1000-1200)

### Visual Elements

- Feature image for every post (on-brand, not generic stock)
- Inline images or diagrams for exercise demos or programming examples
- Pull quotes from athletes in success stories
- Use bullet lists and tables to break up dense content

### Internal Linking

- Link to at least 1-2 related blog posts per article
- Link to relevant product/program pages where natural
- Use descriptive anchor text (not "click here")

---

## SEO Checklist

Before publishing, verify every item:

- [ ] Primary keyword appears in: title, first 100 words, at least one H2, meta description
- [ ] Secondary keywords appear naturally in body text
- [ ] Title tag is under 60 characters
- [ ] Meta description is 150-160 characters
- [ ] URL slug is short, descriptive, and includes primary keyword
- [ ] All images have descriptive alt text
- [ ] At least 2 internal links to other site pages
- [ ] At least 1 external link to a reputable source (if applicable)
- [ ] Headings follow proper hierarchy (H1 > H2 > H3, no skipping)
- [ ] Content is original — not duplicated from other site pages
- [ ] Mobile-friendly formatting (short paragraphs, scannable structure)
- [ ] CTA is clear and relevant to the post topic

---

## Editorial Review Process

### Review Checklist (Human Pass)

**Accuracy**

- [ ] Training science claims are correct and current
- [ ] Exercise descriptions and cues are safe and accurate
- [ ] No misleading outcome promises

**Voice**

- [ ] Reads like DJP Athlete, not generic AI content
- [ ] Personal coaching perspective is present
- [ ] Appropriate tone for the content type

**Legal / Ethics**

- [ ] Athlete names/stories used with consent
- [ ] No medical claims or diagnoses
- [ ] Disclaimers included where needed (e.g., "consult a healthcare provider")

**Quality**

- [ ] No filler paragraphs or repetitive points
- [ ] Every section earns its place — cut anything that doesn't add value
- [ ] Reads well out loud (conversational test)

---

## Content Calendar Cadence

| Frequency | Content Type                                    |
| --------- | ----------------------------------------------- |
| Weekly    | 1 training / educational post                   |
| Bi-weekly | 1 client success story                          |
| Monthly   | 1 industry opinion or coaching philosophy piece |

Adjust based on capacity — consistency beats volume.
