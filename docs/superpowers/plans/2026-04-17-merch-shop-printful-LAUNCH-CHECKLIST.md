# Merch Shop Launch Checklist — Printful Integration

**Date:** 2026-04-17  
**Feature:** Merch shop with Printful fulfillment and Stripe payments

---

## Environment Setup

- [ ] Set `PRINTFUL_API_KEY` in production (use live key, not sandbox)
- [ ] Set `PRINTFUL_WEBHOOK_SECRET` matching the value registered with Printful
- [ ] Set `PRINTFUL_STORE_ID` if using a multi-store Printful account
- [ ] Leave `SHOP_ENABLED=false` in prod until internal QA passes
- [ ] Confirm `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set and verified
- [ ] Confirm Firebase Admin SDK creds set (`FIREBASE_SERVICE_ACCOUNT_KEY`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`)

## Webhook Registration

- [ ] In Printful dashboard, register webhook URL: `https://<prod-domain>/api/shop/webhooks/printful` with events: `package_shipped`, `order_updated`, `order_failed`
- [ ] Confirm Stripe webhook already registered for `checkout.session.completed` (existing setup extended for `shop_order` metadata type)

## Database

- [ ] Run migration `00065_create_shop_tables.sql` (and any fix migrations) against prod DB. Verify all 3 tables and triggers exist.

## Next.js Image Config

- [ ] Add Printful CDN hosts to `next.config.mjs` `images.remotePatterns` if you want to use `<Image>` instead of `<img>` for product thumbnails. Example: `{ protocol: "https", hostname: "files.cdn.printful.com" }` — check actual hostnames from synced products.

## Catalog Seeding

- [ ] In Printful dashboard, set up your initial products (upload artwork, set retail price)
- [ ] In admin, navigate to `/admin/shop/products` → click "Sync from Printful" → verify products appear
- [ ] For each product, edit description (rich text via TipTap) and set active=true, featured as desired
- [ ] Optionally upload lifestyle photo overrides via the image upload on product detail pages

## Internal QA (Staff-Only)

- [ ] With `SHOP_ENABLED=true` on a staging environment or with a whitelist header/IP, walk the full flow as a customer
- [ ] Buy one test product with Stripe test card (`4242 4242 4242 4242`)
- [ ] Verify `checkout.session.completed` webhook fires → order in `/admin/shop/orders` shows status `paid`
- [ ] Click "Confirm to Printful" → verify Printful sandbox order created
- [ ] Simulate Printful `package_shipped` webhook → verify email received with tracking

## Go-Live

- [ ] Switch Printful to live API key
- [ ] Run one real staff order end-to-end with live Stripe + live Printful, verify shipping label and tracking
- [ ] Flip `SHOP_ENABLED=true` in prod
- [ ] Announce to customers / update marketing site nav if needed

## Post-Launch Monitoring (48 Hours)

- [ ] Watch Stripe dashboard for payments
- [ ] Watch Printful dashboard for orders in production
- [ ] Watch app logs for webhook errors, email failures, sync failures
