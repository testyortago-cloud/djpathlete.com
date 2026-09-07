# Sequence reporting — /admin/sequences

Every shot below is the **real app on the real route**, driven with Playwright against
the dev clone, signed in as admin with the `djp_business` cookie set to "Primary"
(`00000000-0000-0000-0000-000000000001`). Nothing is a mockup, a storybook, or a
component rendered in a harness. The callouts are burned into each `.png`, so opening
the file on its own is enough.

Reproduce with:

```bash
npm run dev                                              # port 3050
node scripts/capture-sequence-reporting-screenshots.mjs
```

| # | File | What it shows |
|---|---|---|
| 01 | [01-every-sequence-and-what-happened.png](01-every-sequence-and-what-happened.png) | The `/admin/sequences` list: all nine sequences, each one's entered count and outcome columns, a row explaining why an empty sequence has no runs yet, and the status pill — `On`, `Paused`, `Not started` or `Archived` — on each one. |
| 02 | [02-one-sequence-and-its-people.png](02-one-sequence-and-its-people.png) | `/admin/sequences/cold_lead_re_engagement` — the summary tiles plus the two real people in it: Noor Haddad, who booked a call and left the sequence, and Maya Sorensen, still going through its six steps. |
| 03 | [03-why-somebody-left.png](03-why-somebody-left.png) | `/admin/sequences/quiz_rebuilder` — one person who opted out, with the specific reason (clicked unsubscribe in an email) kept separate from a texted STOP or an existing do-not-contact entry. |
| 04 | [04-an-empty-sequence-says-why.png](04-an-empty-sequence-says-why.png) | `/admin/sequences/new_lead_nurture` — zero entries, and the empty row says why instead of looking like a broken page. |

## Honest gaps in these shots

Two of the six outcome columns are zero in these shots and that is honest, not a gap in
the feature: producing a "Bought" outcome needs a real Stripe checkout and "Something
went wrong" needs a deliberately broken send. The three that are shown — Still going,
Booked a call and Opted out — were all produced by driving real flows on the dev clone,
including a real click-through of the public unsubscribe link. No rows were written by
hand to make these pictures.

## Light only

The admin components were never built against the `.dark` class variant and forcing it
breaks existing pages, so there is no second rendering to capture. That is deliberate,
not an omission.

## The tenant cookie is load-bearing

`resolveAdminTenant()` falls back to `choices[0]` when there is no `djp_business`
cookie, and on this dev clone that is the seeded test business "Northcrest Barbell
10E" — which has no sequences at all. Every shot here was captured after explicitly
setting that cookie to "Primary"; the capture script asserts nine rows are on screen
before taking shot 01, and fails loudly rather than saving a screenshot of a wall of
zeros if the cookie didn't take.

## What these shots deliberately do NOT show, and why

**The failed-run explanation is not pictured, and it cannot honestly be.**

The list and the detail page both explain a run that never sent — the list with a
sentence beside the sequence name, the detail with the reason recorded against
that person. On production this is the most visible thing on the whole screen:
`sms_repermission` is the only sequence with any runs at all, and all 73 of them
failed in the 2026-08-31 domain fault.

It is absent here because **the dev clone has no failed runs, and the real code
path can no longer produce one.** A configuration fault — an unverified sending
domain, an empty sender name — used to destroy the run. It now *defers* instead,
which is exactly the change that stops a repeat of those 73. So the state that
produced them is unreachable on a clone without writing a row by hand, and
writing rows by hand is what this whole file exists to avoid.

The rendering is covered by unit tests instead, and the copy is reviewed. If you
want to see it for real, `/admin/sequences` on production will show it the moment
you open it.

**Two outcome columns are also zero here** — Bought needs a real Stripe checkout,
and Something went wrong is the failed state described above.
