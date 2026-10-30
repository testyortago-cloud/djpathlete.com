# Weekly scan topics: boxes you can switch off, keywords, and research that feeds the scan

Date: 2026-10-31. Source: meeting with Darren, 2026-10-30, 32:53 and 41:36–45:03. The owner skipped the
brainstorming questions ("just do it"), so every design choice below is the builder's call unless marked
as Darren's words.

## Why

Darren, on `/admin/topic-suggestions`:

- "if I research a topic or suggest my own topic, it should add to that weekly auto scan topic, shouldn't
  it? I don't think it does." It does not: neither path touches the scan list, and both write their cards
  dated today, while the scan dates its cards next Monday. The cards therefore land in an "Archive" week
  instead of "This week's brief".
- "their separate boxes almost? And maybe I like, cross them out" (the owner confirmed this was about the
  weekly topics, not assessments).
- "some of the energy system conditioning stuff… I can take that out, but there might be weeks when I want
  to put that back in. So instead of typing that back out…"
- "if I want a specific topic that particular week… agility, change of direction, strength… almost do the
  key words for that particular topic… will that go into the depths of that topic?"

Today the scan list is one textarea, one search per line (`system_settings.blog_scan_queries`, a
`string[]`). Removing a line loses it.

## What gets built

1. **Scan topics are boxes.** Each box is a topic with a name, optional keywords, and an on/off switch.
   A box that is off is crossed out and kept, so it can be switched back on without retyping. Every change
   saves straight away (no Save button to forget).
2. **Keywords go deeper.** A topic with no keywords is searched by its name, exactly as a line is today. A
   topic with keywords is searched once per keyword (`<name> <keyword> research`), so a focus topic gets
   several searches instead of one.
3. **Research and "Suggest your own topic" feed the scan.** Adding researched angles adds the researched
   subject as a scan topic; adding your own topic adds its title. If it is already there it is switched on.
   If the 20-search limit is already used, it is added switched off and the message says so. The card
   itself is added as before.
4. **Added topics land in this week's brief.** Researched and suggested cards are dated the same Monday the
   weekly scan dates its cards, so they sit with that week's brief.
5. **Each card says where it came from:** "Weekly scan", "Researched", "Your topic", "SEO agent".

## Constraints and decisions

- **Storage stays in `system_settings`.** New key `blog_scan_topics` holds the boxes. Saving also writes the
  existing `blog_scan_queries` (the searches of the boxes that are on), which is what the Firebase scan reads
  today. The scan function is not changed, so nothing in `functions/` is deployed for this. Only the
  topics route writes either key.
- **First read migrates.** When `blog_scan_topics` is unset, the boxes are built from `blog_scan_queries`
  (or the defaults): one box per line, named by the line, switched on.
- **At least one search must be on, at most 20.** The scan falls back to the built-in defaults when the
  list is empty, so "everything off" would silently scan the defaults; it is refused instead. 20 is the
  existing limit on queries.
- **No business_id.** This subsystem is platform-owned today (`content_calendar` and `system_settings` have
  no business_id; `lib/tenancy/platform.ts` documents `content_calendar` as platform-owned). No new table is
  added, so no new tenant gap is created. Moving the blog to per-tenant is a separate project.
- **Not changed:** the scanner's cap of 3 candidates per theme stays. A focus week therefore yields at most
  about 3 suggestions per theme. Lifting it for a focus topic is a `functions/` change; flagged, not taken.
- **No per-week schedule.** A switch stays where it is left; "this week" means switching it on now and off
  later. An automatic "on for one week only" was not asked for.

## Left to the builder

Wording of help text, box layout, keyword entry (comma-separated), limits on name and keyword length.
