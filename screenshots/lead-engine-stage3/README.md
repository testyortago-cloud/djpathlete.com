# Stage 3, the chat assistant — captured from the running app

Captured 2026-08-23 by driving the real app with Playwright on branch
`feat/lead-engine-stage3` at commit `31438b90`, dev server on
`localhost:3050`, against the **dev** Supabase project (`anjvztjiokcgiyhobknq`)
— never production.

That is the commit the dev server was actually running, named precisely because
this worktree is shared and the branch moved on underneath the run. The commits
that landed straight after it touch the retention cron and the feature-flag
catalogue; none of them changes any of the nine screens below.

Reproduce with:

```bash
npm run dev                                                 # port 3050
npx tsx scripts/capture-stage3-screenshots.ts .env.local
```

**The real model answered every turn.** Nothing here is stubbed, seeded or
replayed. Every sentence on screen was written by `claude-haiku-4-5` in
response to a question typed into the real composer, went through the real
tool loop, and was checked by the real output validator. A captured stub
would prove the CSS and nothing else.

Every caption and marker is burned into the `.png` itself, composed at the
capture's own pixel width, so nothing is upscaled and each file explains
itself when opened on its own.

**Light only, and that is the complete set.** `.dark` is declared in
`app/globals.css` and applied nowhere: there is no theme provider, no toggle,
and `<html lang="en">` in `app/layout.tsx` carries no class. `components/public/`
contains zero `dark:` utilities. There is no second rendering of these screens
to photograph, so this is nine files rather than eighteen.

## What a visitor sees

| File                          | Size      | What it shows                                                                 |
| ----------------------------- | --------- | ----------------------------------------------------------------------------- |
| `01-launcher-sticky-bar.png`  | 2880x2633 | The way in — a second action on the sticky bar, after 800px of scrolling      |
| `02-panel-programme-card.png` | 2880x2633 | The docked panel with a real price card: `$79.00`, 6 weeks, 4 sessions a week |
| `03-panel-on-a-phone.png`     | 1242x3802 | The same panel on a 414x896 phone, where it takes the whole screen            |
| `04-ask-page.png`             | 2880x2579 | `/ask`, the full-page surface the escalation emails link to                   |
| `05-details-and-consent.png`  | 2880x2633 | The details form, and the marketing tick as a separate, unticked box          |
| `06-empty-camps.png`          | 2880x2525 | No camps or clinics scheduled — the **common** path, not an edge case         |
| `07-blocked-turn.png`         | 2880x2633 | A reply stopped before it reached the visitor, as the visitor sees it         |

`02` is the whole thesis in one frame. The price, the length and the frequency
are drawn by the website from the database; the assistant's own sentence points
at the card rather than repeating the figures, so the common path never needs
the model to type a digit and therefore cannot carry a fabricated one.

`06` is captured as a headline rather than as an error because it is what
almost everybody gets: the clone has three events and all three are drafts, so
zero are published.

`05` needs `business_settings.display_name`, which is `''` in the clone and in
production. That blank is exactly why the tick does not normally render —
`hasChatConsentDisplayName` is the same verdict `/api/ask/capture` reaches
before it will file a consent row, so a tick that cannot name the business is
never shown and never filed.

## What an operator sees

| File                              | Size      | What it shows                                                           |
| --------------------------------- | --------- | ----------------------------------------------------------------------- |
| `08-admin-chat-list.png`          | 2880x2741 | `/admin/chat` — every conversation, with the outcomes worth triaging    |
| `09-admin-transcript-blocked.png` | 2880x2687 | `/admin/chat/<id>` — the stopped reply, the violation, and the fact set |

`07` and `09` are the same turn from both sides, and they are worth reading
together. The visitor asked _"What ages do you coach, and how many kids are
usually in a group?"_ and was shown the fixed refusal. The transcript shows
what was actually written: a reply mentioning _"exactly what's available for
14-year-olds"_, blocked as `ungrounded_number — 14`, beside the six published
FAQs the turn had looked up and the complete list of values the reply was
allowed to contain (`1 · 2 · 8 · 12 · 3 · 4 · 5 · 6585 · 33541 · 6 ·
america/new_york · 21`). Fourteen is not in that list. Nobody had published it.

That is a real block from a real question, reached by asking rather than by
manufacturing: no prompt injection, no stubbed model, no relaxed validator.
Several honest attempts before it were answered honestly instead — asked how
many athletes it had worked with, the assistant said it did not have that
information — which is the good outcome and is why the harness is written to
report "no block reached" rather than to keep pushing until it gets one.

## What the capture run touched, and put back

Two states cannot be reached by driving the interface:

| State                                    | Set to                    | Restored to         |
| ---------------------------------------- | ------------------------- | ------------------- |
| `system_settings.chat_assistant_enabled` | a **new row**, `true`     | the row **deleted** |
| `business_settings.display_name`         | `"Hi Performance Soccer"` | `""`                |

The flag row is deleted rather than set to `false` because it never existed:
"no row" and "a row saying false" are different states to anything that reads
the table's contents, and leaving one behind would be a change, not a restore.
Both were re-read after the run and confirmed — 0 flag rows, blank display name.

**The conversations are deliberately left in place.** They are not fixtures;
they are what the app recorded when the feature was genuinely used, and they
are the subject of `08` and `09`. Deleting them would delete the evidence the
screenshots point at. The `chat.reply_blocked` and `chat.transcript_viewed`
audit rows are likewise the real system doing its job.

Nothing else on the clone was written. `programs` was verified untouched
afterwards — that table has an `updated_at` trigger and its newest row is
still from July.

## One thing worth knowing about, found while doing this

During exploratory probing **before** this script existed, two turns nine
seconds apart came back carrying cards for 38 non-public programmes — clients'
personal plans, with their names and what they paid. The persisted evidence is
in the clone on conversation `a378ede7`.

It does not reproduce, and the committed code is not the cause:
`listPublicProgrammes()` filters on `is_active` **and** `is_public` and
returned exactly one row on 18 consecutive direct calls and on every route call
since. `programs` was not modified (the `updated_at` trigger proves it). The
window coincides exactly with `lib/lead-engine/chat/facts.ts` being written by
a peer session in this shared worktree, which the dev server hot-reloads — so
the most likely reading is that the route briefly ran somebody's half-saved
file, not that this branch ships a leak.

"Most likely" is not "certainly", which is why the harness does not rely on it:
`assertOnlyPublicProgrammes` checks every `/api/ask` response against the
public set read from the database and aborts the run rather than capture a
single non-public name. It passed on every turn in this run. `assertWorkingTreeClean`
refuses to capture at all while `app/`, `lib/` or `components/` differ from
`HEAD`, for the same reason — and it fired for real on the first attempt.

---

## Re-taken after the review fixes — and one thing changed

These were re-captured after the whole-branch review landed its fixes. Two notes
that matter more than the pictures.

**No reply was blocked on the re-run.** Four attempts, all answered honestly by
the real model, and the harness reported that rather than manufacturing a block.
That is not a gap — it is the fixes working. The block captured on the first run
was `ungrounded_number — 14`, produced when the visitor said _"my son is 14"_ and
the assistant answered _"for 14-year-olds"_. Echoing back a number the visitor
themselves supplied is not a fabrication, and that false positive has since been
fixed. Shots `07` and `09` therefore show the closest reachable state, captioned
as such.

**`10-admin-transcript-blocked.png` is a genuine block**, from a conversation
still on record: a real `promised_outcome` violation, with the stopped sentence,
the reason, and the evidence it was checked against.

**And looking at that shot found a defect no test had.** The blocked sentence was:

> "I also **can't promise or guarantee** results like making a team — every
> athlete is different, and that depends on a lot of factors outside of coaching."

The assistant was _refusing_ to promise an outcome — exactly the behaviour the
rule exists to produce — and was blocked for containing the word "guarantee",
because nothing looked to the left of the match. That is the worst shape a
validator can take: it punishes the most correct sentence the assistant can
write. Fixed, with a deliberately short negation window, mutation-proven in both
directions. The screenshot is left as it was taken, because it is the evidence.

**Two cosmetic things visible and not fixed:** the model sometimes emits literal
markdown (`**Rotational Reboot**` renders with asterisks — the panel has no
markdown pass, deliberately), and on the phone the composer placeholder clips
mid-word.
