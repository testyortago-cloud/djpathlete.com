# Session pack history and unpaid-price correction

Implemented locally from `WhatsApp Video 2026-10-03 at 04.35.29.mp4`.

- All recorded check-in dates appear; the six-row display cap is removed.
- Unpaid packs show their total and a **Change price** button. The new amount is the whole-pack total in USD.
- Card-payment edits retire the prior checkout and issue a replacement, retaining the pack's credits, check-ins, payer and renewal setting. Paid/completed checkouts reject changes.
- Copy/email-link, billing-email and price edits share a database lease. Owner-checked writes prevent competing or expired workers from overwriting a payment link. Ambiguous Stripe expiry is checked again; an unknown result keeps the cancellation guard until the lease can be reclaimed after five minutes.
- Price changes invalidate the client page and are audited with the previous and corrected totals. Renewals use the corrected total when auto-renew is already on; the dialog says so.

Open `index.html` for four annotated PNGs. Each capture is the actual `/admin/clients/f7942da3-5593-40e3-88da-fc5c213d6bae` page with its normal header and sidebar. The admin has no supported dark presentation. All eight dates, the edit, invalid input and a real offline save are shown. The offline pack card also shows the corrected total after refresh.

Temporary data was inserted only in development clone `anjvztjiokcgiyhobknq`, then deleted in `finally`. Existing client packs/check-ins were not changed. Browser mutations were blocked except one PATCH of the temporary offline pack. No Stripe calls, emails or production writes were performed. A normal successful audit entry for the temporary offline save remains in the development clone's append-only audit log.

`checks.json` records browser and saved-balance checks. `lease-checks.json` records actual Postgres concurrency and stale-worker recovery checks using another temporary pack (removed after verification).

Stripe replacement and failure behavior was verified with automated tests. A real Stripe replacement link was not created or paid in this session.

## Deployment prerequisite

Apply `supabase/migrations/00285_pack_payment_link_edits.sql` before deploying this code. It is applied to the development clone and was applied to production by the successful migration workflow for commit `5c335a98` before the feature code was pushed. The migration adds two nullable lease fields and leaves all balances and prices intact.

## Reproduce

Use Node 24 (`.nvmrc`) and the local development-clone environment:

```bash
npm run dev -- --webpack
node scripts/capture-pack-price-correction.mjs
npx tsx scripts/verify-pack-link-lease.ts
```

Both scripts refuse any database other than the development clone. The capture requires the existing dev-only login to be enabled.
