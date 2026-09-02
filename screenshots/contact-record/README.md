# Contact record — Full Engine phase 1

Every shot below is the **real app on the real route**, driven with Playwright against
the dev clone. Nothing is a mockup, a storybook, or a component rendered in a harness.
The callouts are burned into each `.png`, so opening the file on its own is enough.

Reproduce with:

```bash
npm run dev                                         # port 3050
node scripts/seed-contact-record-demo.mjs           # the two subjects
node scripts/capture-contact-record-screenshots.mjs
```

| # | File | What it shows |
|---|---|---|
| 01 | [01-rich-contact-record.png](01-rich-contact-record.png) | The whole record for someone with real history — tags, per-channel consent, the do-not-contact list, sequence membership, and a history that unions **three** sources (activity + payments + booked calls). |
| 02 | [02-bare-contact-record.png](02-bare-contact-record.png) | The same screen for someone with nothing. The control for 01: if these two looked the same, the union would be broken for everybody. |
| 03 | [03-list-links-to-the-record.png](03-list-links-to-the-record.png) | The contact list linking each name to its record, with the bulk-select checkbox still beside it. |
| 04 | [04-tag-added-through-the-real-route.png](04-tag-added-through-the-real-route.png) | A tag typed into the real input and written by the real `POST /api/admin/contacts/[id]/tags`. Evidence the route works, not that a fixture renders. |
| 05 | [05-bulk-enrol-still-works.png](05-bulk-enrol-still-works.png) | "Enrolled 1 contact into Cold Lead Re-engagement" — the behaviour the new link had to not break, exercised through the real button. |

## Two things in shot 01 worth knowing

**The money and the booked calls are not in the timeline table.** `contact_timeline_events`
holds the forms, texts and chat. Payments hang off `users` via `contacts.user_id`;
bookings hang off nothing at all (`bookings` has no `contact_id` — migration 00050
predates the contact spine). A screen that selected only from the timeline would show
the forms and silently omit the part the proposal actually sold.

**Those three booked calls are real GoHighLevel rows.** They are matched on a phone
number that `bookings` stores as `(617) 650-4548` while `contacts` stores
`+16176504548`. Those two strings are not equal, which is why the match normalises both
sides in TypeScript rather than using `.eq()` — and why the shot is taken against genuine
data rather than a fabricated booking.

## Light only

The admin components were never built against the `.dark` class variant and forcing it
breaks existing pages, so there is no second rendering to capture. That is deliberate,
not a missing dark-mode shot.
