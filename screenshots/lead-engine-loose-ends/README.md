# Lead Engine loose ends — captured from the running app

Captured 2026-08-23 by driving the real app with Playwright on branch
`feat/lead-engine-loose-ends`, dev server on `localhost:3050`, against the
**dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production.

Reproduce with:

```bash
npm run dev                                                  # port 3050
npx tsx scripts/capture-loose-ends-screenshots.ts .env.local
```

Every caption and marker is burned into the `.png` itself, composed at the
capture's own pixel width (2880 = 1440 CSS px at scale factor 2), so nothing
is upscaled and each file explains itself when opened on its own.

**Light only, and that is the complete set.** `.dark` exists in
`app/globals.css` but the app ships no theme provider, and neither of these
routes carries a single `dark:` class — there is no second rendering to take.

## The contacts screen — `/admin/contacts`

| File | What it shows |
|---|---|
| `01-contacts-list.png` | The list itself: search, the two filters, per-row and whole-page ticking |
| `02-contacts-draft-warning.png` | Twelve contacts ticked with a draft sequence chosen — the warning appears **before** the button is pressed |
| `03-contacts-enrol-refused.png` | After pressing it: nobody enrolled, and the message names the real reason and the next step |

Every sequence in the database is seeded switched off, so a draft is the first
thing a real coach meets. That is why it is documented as the main path rather
than as an error case.

## The consent page — `/sms-consent/<token>`

| File | What it shows |
|---|---|
| `04-consent-ask.png` | What a contact sees on tapping the link in the re-permission email |
| `05-consent-confirmed.png` | After pressing "I agree" |
| `06-consent-stopped.png` | Someone who already texted STOP — no button, and the honest reason |
| `07-consent-not-ready.png` | The business has no name on file, so there is no sentence to agree to |

The sentence in `04` is the exact string filed as `contact_consents.wording_shown`.
The page never hands its own copy to the write, so the two cannot drift apart.

## What the capture run touched, and put back

Three states cannot be reached by driving the interface, so the script sets
them up on the clone and reverses every one in a `finally` block: a business
with its display name filled in, two contacts carrying phone numbers, and a
suppression row standing in for a past STOP. Verified afterwards — display
name back to blank, both contacts gone, suppression gone, contact count back
to its original 10.

That is why `01`–`03` read "12 contacts": the two temporary ones were present
at the moment of capture. Their phone numbers are what make the Phone column
worth looking at, since the seeded clone contacts carry none.
