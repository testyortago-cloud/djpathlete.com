# Two-way SMS — annotated screenshots

Every shot below is the **real app on the real route**, driven with Playwright against the dev
clone on `http://localhost:3050`, signed in as the operator admin with the `djp_business` cookie
set to **Primary** (`00000000-0000-0000-0000-000000000001`). Nothing is a harness, a storybook or
a scratch page. The callouts are burned **into** each PNG — open the file and the numbers are
there.

Captured at 1440 CSS px wide at device-scale-factor 2, so every image is **2880px wide** — the
capture's own pixel width. Nothing is upscaled; the extra height on each file is the caption band.

**Light mode only.** The admin UI is light-only — `.dark` is a class variant these components were
never built against, and forcing it breaks existing pages. There is no dark capture to take.

Re-make them with:

```bash
node scripts/seed-sms-thread-dev.mjs          # dev clone only; refuses anything else
npm run dev > /tmp/dev.log 2>&1 &             # port 3050
node scripts/capture-two-way-sms-screenshots.mjs
```

---

1. **[01-thread-list.png](01-thread-list.png)** — `/admin/sms`, 2880x2419.
   The whole list of text conversations, one row per phone number, newest first. Look at the
   **Status** column: the last text to Dana reads `failed`, so a text that never arrived is visible
   without opening anything. Also look at the top row — a number nobody has on file still gets its
   own conversation and says _"Not in your contacts"_, because the thread is keyed on the phone
   number, not on a contact record.

2. **[02-conversation.png](02-conversation.png)** — `/admin/sms/+12025550123`, 2880x2473.
   One conversation, both directions: hers on the left, ours on the right. Look at the small line
   under each of **our** bubbles — every outbound text carries its own delivery state, and the last
   one reads `failed (30006)` in red. That is the point of the screen: "they ignored me" and "it
   never landed" look identical without it.

3. **[03-compose-segments.png](03-compose-segments.png)** — same route, with a draft typed in,
   2880x2473. Look at the two lines under the box: `96 characters · 2 segments`, and the amber note
   saying one emoji switched the message to UCS-2 so each text now holds 67 characters instead of 160. The count is live as you type and comes from the same function the send route bills against.

4. **[04-suppressed-refusal.png](04-suppressed-refusal.png)** — `/admin/sms/+13105550198`,
   2880x2419. Marcus texted `STOP` (visible as the last bubble), so the compose box is switched off
   and says why, including how he can come back — he texts `START` himself. Look at the greyed-out
   **Send** button and the disabled typing box. The server refuses this send independently; the
   disabled button is the explanation, not the guard.

5. **[05-quiet-hours-warning.png](05-quiet-hours-warning.png)** — same route as 02, after pressing
   **Send** once, 2880x2419. The first press warns and does **not** send. Look at the amber line: it
   reads the clock where _Dana_ is (her own timezone, named in the message), not where the coach is.
   The button has changed its words to **"Send anyway"**, and a **"Not now"** button has appeared
   beside it. The second press was never made, so nothing left this screen.

6. **[06-contact-text-link.png](06-contact-text-link.png)** — `/admin/contacts/<Dana's id>`,
   2880x2783. The **"Text"** action in the contact header, beside "Add to a sequence". It links
   straight to that person's conversation and only renders when there is a phone number on file.
   Also worth a look further down: her permission row says she agreed to be texted, with the exact
   wording she was shown and the date.

---

## What the data is

Seeded by `scripts/seed-sms-thread-dev.mjs`, which refuses to run against anything but the dev
project ref. Two fictional contacts (Dana Okafor, Marcus Ferreira) and one unknown number, on
reserved-for-fiction numbers: `555` as the **exchange** behind a real area code
(`+1 202 555 0123`, `+1 310 555 0198`, `+1 415 555 0132`). A bare `+1555…` would be _invalid_, not
fake — `normalisePhone` returns null for it and the thread page 404s.

**No text was ever sent.** Every row is written straight into `sms_messages`, the way the inbound
webhook and `sendManualSms` write them. The seed sets
`business_settings.sms_messaging_service_sid` to the obviously-fake `MGdev0000000000000000000000000000`
purely so the compose box renders in its working state rather than its "Texting is not set up"
state; any real send would still die at Twilio.

## What is not shown here

The **"Automatic"** marker on a text the sequence engine sent. It renders when an `sms_messages`
row points at a `sequence_messages` row, and the dev clone has exactly one such row — an _email_,
to a different person. Linking a seeded text to it would have been a fabrication, so the marker is
absent from these shots rather than faked.
