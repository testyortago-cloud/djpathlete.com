# Continuation prompt — funnel page editing (next session)

Paste the block below as your first message. Everything above it is context for
a human; the prompt itself is self-contained.

---

## THE PROMPT

> Continue the funnel page-editing work on DJP Athlete. Read
> `JOURNAL.md` (top three entries, 2026-08-15) before anything else — it has the
> state, the traps and the two open jobs.
>
> **Job 1 (the ask): make ALL page text click-editable.** Right now the whole
> form and the island CTA button labels cannot be clicked and typed into on the
> canvas, which on a lead-gen page is most of the page. Diagnosis and both fixes
> are written up in the `[Open gap]` journal entry — do not re-derive them.
>
> **Job 2 (only if I say so): anonymous Stripe checkout from a funnel page.**
> Spec is `docs/superpowers/specs/2026-08-15-funnel-anonymous-checkout-design.md`
> and the money core is already built and tested at
> `lib/funnels/checkout/grant.ts`. Nothing calls it yet.
>
> Verify Job 1 in a REAL BROWSER before calling it done — the whole feature
> shipped completely inert once already and 900+ green tests did not notice.
> Do not push without telling me.

---

## What a fresh session needs to know

### State as of 2026-08-15

Everything is **pushed and live** through `b7fb2e90`. Click-to-edit works:
click selects a section and fills the inspector, double-click types into text,
Enter saves, the transcript records it, and "Go back to here" undoes it. Image
slots, growable lists and section reorder all work. The Craft.js drag designer
is **parked** (`lib/funnels/tree/parked.ts`) — do not revive it without asking.

### Job 1 — make all text editable

**The gap, enumerated in the live browser (not guessed):**

- **The form island** — field labels, select options, the consent line, the
  submit label. This is the important half.
- **Island CTA labels** — checkout, booking, event.

**Leave alone, deliberately:** the `testimonials` and `faq` islands render LIVE
ROWS from their own tables. Editing them here would edit the wrong record. They
should *say* that when clicked, not appear broken.

**Two mechanisms, because one will not cover both:**

1. **CTA labels — small.** Wrap the island in an edit-mode-only
   `<span data-edit="cta.label">`. `anchoredRun` in `lib/funnels/sections/render.ts`
   already does exactly this for `djp-plan-price`; copy that shape. Published
   markup must not change — the byte-identity test across all ten kinds is the
   guard and it must stay green.
2. **Form internals — medium, and the one that matters.** Each string needs its
   own path (`submitLabel`, `fields.0.label`, `consentText`), which a wrapper
   cannot express. Add an `editable` flag to `FunnelRenderContext` and have
   `FormIsland` stamp its own `data-edit` anchors. The paths are already correct
   relative to the section's props, because a form section's props ARE the
   island's props (an intersection with `formIslandSchema`).

**Why `data-edit` cannot simply go on the island div:** `convertIsland` in
`lib/funnels/compile/sanitize.ts` consumes the element before `filterAttrs`
runs, so the attribute never survives the compiler. That is why the wrapper
trick exists.

### The traps that have already cost time here

- **A node from the iframe is NOT `instanceof` the parent window's `Element`.**
  Separate realm. This shipped the entire canvas dead with every test green.
  Recognise DOM things by capability (`typeof v.closest === "function"`), never
  by `instanceof`. See `asElement` in `canvas-editing.ts`.
- **jsdom is ONE realm and never loads an iframe**, so no unit test can see that
  class of bug. Anything crossing the frame boundary must be driven in a real
  browser.
- **Never `Get-Content -Raw` → transform → `Set-Content` a source file** in
  PowerShell. It double-encodes every non-ASCII character and tests, tsc and
  build all stay green. Mutate with the Edit tool; revert with `git checkout --`.
- **Do not chain cleanup onto a verification command.** A `Remove-Item` on a
  locked file reported exit 1 straight after a build that had succeeded.
- **`@testing-library/user-event` is not a dependency.** Use `fireEvent`.
- **`git add -A` is unsafe here** — the tree permanently holds a bank CSV. Stage
  explicit paths.
- **When a component can render N of a thing, never query for it globally in a
  test.** An unscoped `getByRole("button", {name: /add/})` found the wrong list's
  button and passed for the wrong reason.

### Driving the app in a browser (this works, use it)

1. `npm run dev` (port 3050). `.env.local` points at the **clone** (`anjvz…`),
   which is safe to drive — never verify data work against it, but it is the
   right place to click around.
2. Mint an admin session rather than logging in: `encode()` from
   `next-auth/jwt`, `secret = AUTH_SECRET`, **`salt` = the cookie name**
   (`authjs.session-token`). Set it with `document.cookie`, then confirm with
   `fetch('/api/auth/session')` before trusting it.
3. The clone's AI-built page:
   `/admin/funnels/a7450381-3042-4f0b-9236-abf3bf8e10ad/edit/7f5da342-aa37-42aa-bed3-020842893da9`
4. To find what is still not editable, walk the preview's text nodes and report
   any whose `parentElement.closest('[data-edit]')` is null, grouped by
   `closest('[data-djp-island]')`. That is how the current list was produced.

### Job 2 — anonymous checkout (only on request)

Spec: `docs/superpowers/specs/2026-08-15-funnel-anonymous-checkout-design.md`.
Built: `lib/funnels/checkout/grant.ts` + tests. **Unbuilt:** the migration and
ledger DAL, `POST /api/funnels/checkout`, the Stripe webhook branch, and the
funnel-page capture form. It is a money path — flag-gated and off by default,
and do not push it without an explicit go-ahead.

**Do not re-litigate these**, they are settled in the spec: account is created
AFTER payment by the webhook with a set-password email; find-before-create on
the email; programs granted through `assignProgram()`/`assertAssignmentPayable`;
a funnel-bought session pack is NEVER auto-renew-armed. Phasing is
**programs → packs → events → digital products** (events need the full signup
form and a liability waiver, so they are not the cheap one).
