# Pasting a reference design into the builder chat — Phase 1

Every PNG here carries its own numbered markers and captions burned in, so each one
stands alone. This sheet is the running order and the evidence behind the claims.

**How these were made.** `scripts/capture-builder-reference-image.mjs` drives the real app
on the real route (`/admin/funnels/[id]/edit/[stepId]`) against the DEV CLONE, with real
model calls. The image is pasted as a real DOM `paste` event carrying a real `File` — not
`setInputFiles` on the hidden picker, because paste is the path with the new handler on it.
Regenerate the reference first with `node scripts/make-reference-brand-board.mjs`.

**The script refuses to caption a pass it did not get.** It throws rather than shooting if
the theme does not move, if the model writes no `designNote`, if the follow-up turn does
not COMPLETE, if the follow-up changes nothing, or if the preview route does not show this
page's own headline. Three of those guards were added because an earlier draft had already
produced a false caption — see "What went wrong on the way here" below.

---

## The running order

| # | File | What it shows |
|---|---|---|
| — | `reference-brand-board.png` | **The input.** A designer's brand board: deep clay `#A8563A`, tan `#C99A6B`, warm paper `#FBF6EE`, near-black `#2A1D16`; a Playfair display face; and two written rules — "generous air" and "full measure". Deliberately nothing the builder reaches by default. |
| 0 | `00-before-the-reference.png` | **Before.** The same page restored to step 34, the last version written before any reference image, so the comparison is fair. Builder defaults: Green Azure, Lexend, normal spacing. |
| 1 | `01-reference-image-staged-in-chat.png` | **The paste.** The board attached to the composer, shown by name and by its size *after* the browser shrank it — 2800px wide down to 82 KB. Removable before anything is spent. |
| 2 | `02-the-model-says-what-it-could-not-match.png` | **The turn.** The transcript records that a reference rode with it, and the reply names what it took: the two hexes as a custom palette, serif headings, airy density, a wide measure, an alternating rhythm. |
| 2b | `02b-what-it-could-not-match.png` | **The honesty.** The same reply scrolled down — it is longer than the pane. "What I couldn't match: Playfair Display and Inter Light by name … and the 01/02 numbered swatch-and-rule layout has no equivalent in this vocabulary." |
| 3 | `03-the-durable-design-note.png` | **The memory.** `theme.designNote` in the Page design panel, readable and editable. The board's own hexes are in Custom colours — not one of the twelve presets. |
| 4 | `04-the-page-the-reference-produced.png` | **The result**, on `/preview/<slug>/<step>`, the same renderer publish uses. |
| 5 | `05-the-direction-survives-later-turns.png` | **The point of the whole design.** "Make the headline bolder." sent with NO attachment, on a completed turn that really did rewrite the page — and the brief still holds. |

---

## What the model actually did with the image

Read off the board and written into the document, this run:

| Board says | Document got |
|---|---|
| `#A8563A` clay, `#C99A6B` tan | `palette: { mode: "light", brand: "#A8563A", accent: "#C99A6B" }` — typed in, not a preset |
| Playfair display face | `font: "editorial"` — and it said out loud that Playfair itself is unavailable |
| "Generous air" | `density: "airy"` |
| "Full measure … edge to edge" | `width: "wide"` |
| Square swatches, hard rules | `radius: "sharp"` |
| "Nothing is crowded" | `rhythm: "alternating"` |

Full transcript of both turns, both themes and the note: `capture-log.txt`.

**The durability claim, stated precisely.** After the follow-up turn the note reads:

> "… Owner asked for a bolder headline, so headings are the condensed 'bold' pairing instead
> of the board's editorial serif."

The model changed the thing it was asked to change, kept every other rule from the board, and
amended the note to record *why* it had departed from it — while offering to revert. That is
the behaviour `designNote` exists for: the image is never stored, so the note is the only
memory of the brief, and it is in front of the model on every later turn because the whole
document is the per-turn context.

---

## What went wrong on the way here

Kept because each one is a trap that will be walked into again.

1. **Waiting on the wrong column.** The first stability check keyed on `doc_revision`. The
   route records the owner's message *before* spending anything, so the user turn bumps the
   revision without touching the draft — the check called that "settled", counted twenty
   quiet seconds while the model was still thinking, and killed the browser mid-request. Key
   on `project_data`.
2. **A wrong URL that resolved.** A `/preview/camp-kfcsg` left over from the script this one
   was patterned on *loaded fine* — it is a real funnel on this clone, just not the one under
   test — so the fallback never fired and a red-and-green page shipped under a caption
   claiming warm paper and deep clay. A wrong URL that 404s announces itself; one that
   resolves does not. The slug is now read from the database and the page is checked for this
   page's own headline before it is captioned.
3. **A verification check that failed on the right page.** Its replacement stripped short
   words out of the headline and then looked for the survivors as one contiguous string in
   page text that still had them — "Built to last" became "Built last", which can never
   appear. Compare word by word. (Word-level also dodges the apostrophe trap: `escapeHtml`
   encodes `'`, so `includes` of raw authored copy false-negatives.)
4. **An assertion that passed on a failed turn.** The follow-up check originally asked only
   whether `designNote` still existed afterwards — and passed, loudly, on a turn that had
   failed outright ("I couldn't build that", a schema violation on a 100k-token document).
   The note had survived because *nothing was written at all*, which is the opposite of the
   claim. The turn's own outcome is now read from `funnel_step_turns` and a failed turn is
   retried, not photographed.
5. **A marker pointing below the fold.** The reply is longer than the chat pane, so a single
   frame could not hold both the attachment record and the "couldn't match" sentence. The
   marker for the second one silently landed on the fallback coordinate and captioned the
   toolbar. Two shots now, each captioning only what is in its own frame.
6. **A caption that outlived its run.** "Full-bleed measure" was hand-typed while the theme
   said `width: "full"`; the next run chose `"wide"` and the caption kept claiming "full".
   Shot 4's captions now interpolate the stored values.
7. **A marker on the wrong control.** The palette marker pointed at the twelve-preset grid
   while its caption quoted two hex values the model had typed into Custom colours below it.

---

## Reproducing

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx next dev --port 3061          # NOT 3050 — another session owns that port
node scripts/make-reference-brand-board.mjs
node scripts/capture-builder-reference-image.mjs
```

Dev clone only — the script refuses to run against any other Supabase project. It spends
real model credits, resets the page under test back to step 34 first, and leaves the page in
its post-follow-up state.
