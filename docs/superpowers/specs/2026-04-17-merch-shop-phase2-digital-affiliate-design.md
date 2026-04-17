# Merch Shop Phase 2 — Digital PDFs & Amazon Affiliate — Design

**Date:** 2026-04-17
**Status:** Approved for implementation planning
**Builds on:** [2026-04-17-merch-shop-printful-design.md](./2026-04-17-merch-shop-printful-design.md)

## Goal

Extend the v1 Printful POD merch shop with two new product types:

1. **Digital PDF downloads** — paid (via existing cart/checkout) or free (email-gated lead magnet), with admin-controlled access windows, link expiry, and download caps.
2. **Amazon affiliate links** — manually curated Amazon products shown in the shop grid that redirect externally (with your Associates tag) and track clicks internally.

Both surface through the existing `/shop` storefront and `/admin/shop` admin UI with full admin control.

## Scope

**In scope (Phase 2):**
- `product_type` enum on `shop_products`: `pod` / `digital` / `affiliate`.
- Digital product management (create, edit, multi-file bundles, free/paid mode, access settings).
- Digital fulfillment — Stripe webhook issues downloads instantly; permanent download page re-serves signed URLs.
- Free PDF lead capture + Resend audience sync + local `shop_leads` audit table.
- Affiliate product management (manual entry, global Associates tag, click tracking).
- Admin leads page with filters + CSV export.
- Independent feature flags per new type.

**Out of scope (Phase 2.x / later):**
- DRM / watermarked PDFs
- Subscription / membership digital content
- Affiliate networks beyond Amazon (ShareASale, Impact, etc.)
- Admin bulk-import of affiliate products
- Lead-magnet email nurture sequences beyond initial Resend tag
- Analytics beyond click / download counters

## Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Abstraction | Unified `product_type` enum on `shop_products` | Shared catalog, grid, admin shell; branch behavior by type |
| 2 | Digital pricing | Free (email-gated) or paid (cart); admin picks per product | Lead magnets and sellable content use same product record |
| 3 | Checkout | Mixed cart; digital fulfills instantly on webhook; POD waits for admin confirm | One-checkout UX, fastest digital delivery, preserves v1 POD safety gate |
| 4 | Digital access | Permanent download page with admin-set access window, signed-URL TTL, optional max-download count | Supports guest checkout, reduces "lost email" tickets, bounded blast radius |
| 5 | File count | Multiple files per digital product | Bundles (workbook + audio + worksheets) are common |
| 6 | Free-PDF leads | Resend audience sync + local `shop_leads` row | Resend is marketing source of truth; local row preserves audit trail on sync failure |
| 7 | Affiliate storefront | Card mixed in main grid; CTA is external redirect; no cart integration | Affiliate is fundamentally outbound — forcing cart creates false UX |
| 8 | Affiliate data | Manual entry; global Amazon Associates tag from env; appended server-side | Avoids PA-API approval overhead; tag stays out of DB |
| 9 | Click tracking | `/shop/go/[productId]` internal 302 with DB log | Reliable tracking independent of Amazon dashboard or adblockers |
| 10 | Flags | `SHOP_DIGITAL_ENABLED` + `SHOP_AFFILIATE_ENABLED`, independent | Different risk profiles; allows staggered rollout and quick disable |
| 11 | Leads admin | Full `/admin/shop/leads` page with filters + CSV export | Admin wants in-app visibility per prior answer |

## Data Model

Three migrations, each small and independently reversible.

### Migration: `000NN_shop_product_types.sql`

```sql
CREATE TYPE product_type AS ENUM ('pod', 'digital', 'affiliate');

ALTER TABLE shop_products
  ADD COLUMN product_type product_type NOT NULL DEFAULT 'pod',
  ADD COLUMN affiliate_url          text,
  ADD COLUMN affiliate_asin         text,
  ADD COLUMN affiliate_price_cents  integer,
  ADD COLUMN digital_access_days    integer,          -- null = forever
  ADD COLUMN digital_signed_url_ttl_seconds integer NOT NULL DEFAULT 900,
  ADD COLUMN digital_max_downloads  integer,          -- null = unlimited
  ADD COLUMN digital_is_free        boolean NOT NULL DEFAULT false;

-- Existing POD rows remain product_type='pod'. No data migration needed.

-- Status enum extension for digital-only fulfillment
ALTER TYPE shop_order_status ADD VALUE 'fulfilled_digital';
```

### Migration: `000NN_shop_product_files.sql`

One row per digital file attached to a product.

```sql
CREATE TABLE shop_product_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  file_name       text NOT NULL,       -- "comeback-code-workbook.pdf"
  display_name    text NOT NULL,       -- "Workbook (42 pages)"
  storage_path    text NOT NULL,       -- private Firebase Storage path
  file_size_bytes bigint NOT NULL,
  mime_type       text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_product_files_product ON shop_product_files(product_id);

-- RLS: service role only. Never readable by public.
ALTER TABLE shop_product_files ENABLE ROW LEVEL SECURITY;
```

### Migration: `000NN_shop_order_downloads.sql`

One row per (order, file) pair, created when a paid digital order completes.

```sql
CREATE TABLE shop_order_downloads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES shop_products(id),
  file_id            uuid NOT NULL REFERENCES shop_product_files(id),
  access_expires_at  timestamptz,           -- null = forever; else created_at + digital_access_days
  download_count     integer NOT NULL DEFAULT 0,
  max_downloads      integer,               -- snapshot of product setting at creation
  last_downloaded_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_order_downloads_order ON shop_order_downloads(order_id);
CREATE UNIQUE INDEX idx_shop_order_downloads_order_file ON shop_order_downloads(order_id, file_id);

ALTER TABLE shop_order_downloads ENABLE ROW LEVEL SECURITY;
-- service role only
```

### Migration: `000NN_shop_leads.sql`

Free-PDF email captures. Local audit trail independent of Resend.

```sql
CREATE TABLE shop_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES shop_products(id),
  email               text NOT NULL,
  resend_contact_id   text,
  resend_sync_status  text NOT NULL DEFAULT 'pending',  -- 'pending' | 'synced' | 'failed'
  resend_sync_error   text,
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, email)
);

CREATE INDEX idx_shop_leads_product ON shop_leads(product_id);
CREATE INDEX idx_shop_leads_created ON shop_leads(created_at DESC);

ALTER TABLE shop_leads ENABLE ROW LEVEL SECURITY;
-- service role only
```

### Migration: `000NN_shop_affiliate_clicks.sql`

```sql
CREATE TABLE shop_affiliate_clicks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  clicked_at   timestamptz NOT NULL DEFAULT now(),
  ip_address   text,
  user_agent   text,
  referrer     text
);

CREATE INDEX idx_shop_affiliate_clicks_product_time
  ON shop_affiliate_clicks(product_id, clicked_at DESC);

ALTER TABLE shop_affiliate_clicks ENABLE ROW LEVEL SECURITY;
-- service role only
```

### TypeScript enum additions (`types/database.ts`)

```ts
export type ProductType = "pod" | "digital" | "affiliate";

export type ShopOrderStatus =
  | "pending"
  | "paid"
  | "draft"
  | "confirmed"
  | "in_production"
  | "shipped"
  | "canceled"
  | "refunded"
  | "fulfilled_digital";   // NEW — digital-only orders bypass POD states
```

### Variants and non-POD products

The v1 schema stores `retail_price_cents` on `shop_product_variants`, and `shop_orders.items` jsonb references `variant_id`. To keep cart, checkout, and order item structure uniform across product types:

- **Digital products** get exactly **one auto-created variant row** on product save (name = "Default", size/color null, `retail_price_cents` = product price, `printful_*` fields null). Admin UI hides the variants panel for digital products; the top-level "price" field on the digital form writes through to this single variant.
- **Affiliate products** never enter cart/order flows, so they do **not** get a variant row. Their reference price lives in `shop_products.affiliate_price_cents` and is display-only.

This means all cart/checkout/Stripe-line-item code keeps referencing `variant_id` uniformly; only digital-specific fulfillment (file issuance) and affiliate-specific storefront (external redirect) branch on `product_type`.

## Architecture

### Public routes (`app/(marketing)/shop/`)

| Route | Status | Purpose |
|---|---|---|
| `shop/page.tsx` | extended | Grid includes all three product types; respects both new flags |
| `shop/[slug]/page.tsx` | extended | PDP branches by `product_type` |
| `shop/go/[productId]/route.ts` | **new** | Logs click; 302-redirects to `affiliate_url` with global tag |
| `shop/orders/[orderNumber]/downloads/page.tsx` | **new** | Email-gated permanent download page |

### API routes (`app/api/`)

| Route | Method | Status | Purpose |
|---|---|---|---|
| `api/shop/quote` | POST | extended | Shipping computed only on POD lines; digital/affiliate contribute 0 |
| `api/shop/checkout` | POST | extended | Re-validates by type; rejects affiliate lines; Stripe line items carry `metadata.type` |
| `api/stripe/webhook` | POST | extended | Partitions shop-order items by type; issues digital downloads; assigns terminal status |
| `api/shop/leads` | POST | **new** | Free-PDF email capture, rate-limited; creates lead, syncs Resend, emails link |
| `api/shop/downloads/sign` | POST | **new** | Verifies access; increments count; returns signed Firebase URL |
| `api/uploads/shop-pdf` | POST | **new** | Admin-only signed upload to **private** Firebase bucket |
| `api/admin/shop/leads/export` | GET | **new** | Admin-only CSV stream |
| `api/admin/shop/downloads/[id]/revoke` | POST | **new** | Sets `access_expires_at = now()` on a download row |

### Admin routes (`app/(admin)/admin/shop/`)

| Route | Status | Purpose |
|---|---|---|
| `products/page.tsx` | extended | Type badge column + type filter tabs + "Add product" split button |
| `products/new/digital/page.tsx` | **new** | Manual digital-product creation form + file uploader |
| `products/new/affiliate/page.tsx` | **new** | Manual affiliate-product creation form |
| `products/[id]/page.tsx` | extended | Branches rendering by `product_type`; digital/affiliate-specific panels |
| `orders/[id]/page.tsx` | extended | Digital-fulfillment block with per-file controls |
| `leads/page.tsx` | **new** | Leads table, filters, CSV export |

### New libraries (`lib/`)

| Path | Purpose |
|---|---|
| `lib/db/shop-product-files.ts` | DAL for `shop_product_files` |
| `lib/db/shop-order-downloads.ts` | DAL; includes atomic `incrementDownloadCount` with max-count guard |
| `lib/db/shop-leads.ts` | DAL |
| `lib/db/shop-affiliate-clicks.ts` | DAL |
| `lib/shop/feature-flag.ts` | extended: `isShopDigitalEnabled()`, `isShopAffiliateEnabled()` |
| `lib/shop/downloads.ts` | Firebase Admin signed-URL generation; access policy check |
| `lib/shop/amazon.ts` | `buildAffiliateUrl(rawUrl, tag)`; strips existing tag, validates `amazon.*` host |
| `lib/shop/resend-audience.ts` | Contact upsert + tag helpers |
| `lib/validators/shop-phase2.ts` | Zod schemas for digital/affiliate product input, lead form, download sign request |

### Environment variables (new)

```
AMAZON_ASSOCIATES_TAG=djp-20
FIREBASE_PRIVATE_BUCKET=djp-athlete-downloads   # separate from public images bucket
RESEND_AUDIENCE_ID=aud_xxx                      # target list for lead magnet sync
SHOP_DIGITAL_ENABLED=false
SHOP_AFFILIATE_ENABLED=false
```

## Customer Flows

### A. Paid digital (mixed with POD in cart)

```
PDP (paid digital) → Add to Cart → /shop/cart → /shop/checkout
  → Stripe (shipping computed on POD lines only; 0 for digital lines)
  → webhook fires
      → POD lines: status='paid' (admin confirms later)
      → Digital lines: shop_order_downloads rows created immediately
      → Email: "Your download is ready" with link to /shop/orders/[n]/downloads
  → thank-you page shows "Download now" button if any digital lines present
```

### B. Digital-only order

Same pipeline as A, but after webhook: order status jumps directly to `fulfilled_digital`. Thank-you page is the primary download hand-off.

### C. Free PDF (email gate)

```
PDP (digital_is_free=true) → "Enter your email for free download" form
  → POST /api/shop/leads { email, product_id }
      → rate-limit check (3/min per IP)
      → upsert shop_leads row (UNIQUE on product_id+email — repeats re-send email)
      → queue Resend audience sync with tag "lead-magnet:<slug>"
      → email signed download link(s), TTL = product's digital_signed_url_ttl_seconds
  → PDP shows "Check your email" success state
```

No Stripe, no cart, no order row. Free PDFs generate leads, not orders.

Free PDFs therefore do **not** use the `/shop/orders/[orderNumber]/downloads` re-access page (no order number exists). If a customer loses the email, they re-submit the form on the PDP and receive a new email — the lead row's UNIQUE constraint prevents duplicates. `digital_max_downloads` does not apply to free PDFs (no `shop_order_downloads` row tracks the count); only `digital_signed_url_ttl_seconds` matters for the emailed link.

### D. Affiliate

```
Card / PDP CTA links to /shop/go/[productId] (target="_blank", rel="nofollow sponsored noopener")
  → route handler inserts shop_affiliate_clicks row
  → 302 redirect to buildAffiliateUrl(affiliate_url, AMAZON_ASSOCIATES_TAG)
```

### Download re-access (applies to A and B)

```
/shop/orders/[orderNumber]/downloads
  → email gate form (existing order-lookup pattern; rate-limited 5 / 10 min)
  → on match: lists files with per-file download count + "Download" button
  → click → POST /api/shop/downloads/sign { order_number, email, download_id }
      → verify: access_expires_at > now AND download_count < max_downloads (if set)
      → atomic increment download_count, set last_downloaded_at
      → return signed Firebase URL (TTL = product setting)
  → browser follows signed URL, file downloads
```

### Error handling

| Case | Handling |
|---|---|
| Free-PDF form submitted by bot | Rate limit + honeypot `website` field + email-format validation |
| Resend sync fails | `shop_leads.resend_sync_status='failed'` + error stored; download email still sent; admin retries from leads page |
| Digital webhook fires twice | Idempotent: unique index `(order_id, file_id)` on `shop_order_downloads` |
| Access window expired | Download page shows "Access expired — contact support"; admin can extend via order detail |
| Max downloads hit | "Download limit reached"; admin can bump per-row max |
| Refund on digital order | Admin order detail combined "Refund + revoke downloads" action; sets all rows' `access_expires_at = now()` |
| Affiliate URL malformed / non-Amazon host | `buildAffiliateUrl` validates `amazon.*` host; admin form validates on save; `/shop/go/[id]` returns 400 on runtime mismatch |
| Guest buys digital then loses email | Order lookup + email challenge reissues access page |

## Admin Control Surfaces

### Products list (`/admin/shop/products`) — extended
- New column: **Type** badge (POD / Digital / Affiliate), color-coded.
- New filter tabs: **All / POD / Digital / Affiliate**.
- "Sync from Printful" stays (only touches POD rows).
- "Add product" split button → "New digital product" / "New affiliate product". POD products still only arrive via sync.

### Digital product detail

**Identity & pricing**
- Name, slug (immutable after first save), description (TipTap), thumbnail upload.
- `digital_is_free` toggle. When on: price disables and label reads "Free lead magnet — collects email".
- `retail_price_cents` when paid.

**Access settings**
- `digital_access_days` — number input or "Forever" toggle (null).
- `digital_signed_url_ttl_seconds` — select: 15min / 1h / 4h / 24h.
- `digital_max_downloads` — number input or "Unlimited" toggle (null).

**File manager**
- Drag-drop uploader → `/api/uploads/shop-pdf` → private bucket.
- Table of `shop_product_files`: display name (editable), file name (read-only), size, sort handle, delete.
- Validation: PDF / ZIP / video mime types, max 500MB per file, max 20 files per product.

**Stats**
- Leads captured (free products), total downloads issued, active (non-expired) grants.

### Affiliate product detail

**Identity**
- Name, slug, description, image upload.

**Link**
- `affiliate_url` — validated against `amazon.*` host on save; preview shows URL with tag appended.
- `affiliate_asin` — optional; auto-extracted from URL if present.
- `affiliate_price_cents` — optional reference price, rendered as "~$24.99" on card.

**Stats**
- Total clicks, clicks last 7 days, clicks last 30 days.

### Orders detail — extended

- New "Digital fulfillment" block appears when order contains digital lines.
- Per-row (`shop_order_downloads`): file name, download count, max, access_expires_at, last_downloaded_at.
- Per-row actions: **Extend access** (datetime picker), **Revoke**, **Bump max downloads** (inline).
- Panel hidden for non-digital orders.

### Leads page (`/admin/shop/leads`) — new

- Filters: product (multi-select), date range, Resend sync status.
- Columns: email, product, created_at, Resend status badge, actions.
- Per-row "Retry Resend sync" when `resend_sync_status='failed'`.
- "Export CSV" button streams `/api/admin/shop/leads/export`.

## Feature Flags

| Flag | Off behavior |
|---|---|
| `SHOP_ENABLED=false` | All public `/shop/*` shows Coming Soon or 404. Admin shop remains accessible. |
| `SHOP_DIGITAL_ENABLED=false` | Digital products hidden from public grid; digital PDP 404s. Admin UI fully functional. Webhook digital branch stays active. |
| `SHOP_AFFILIATE_ENABLED=false` | Affiliate products hidden from public grid; `/shop/go/[id]` returns 404. Admin UI fully functional. |

Webhooks are always active regardless of flag state (so in-flight orders and downloads aren't lost if flags toggle mid-flight).

## Testing Strategy

### Unit (Vitest)

- DAL CRUD and edge cases for `shop-product-files`, `shop-order-downloads`, `shop-leads`, `shop-affiliate-clicks`.
- `lib/shop/amazon.ts` — URL parsing, tag strip-and-append, non-Amazon host rejection.
- `lib/shop/downloads.ts` — mocked signed URL generation; access policy (expired window, max downloads hit, revoked).
- `lib/shop/resend-audience.ts` — mocked `fetch`, payload and tag shape, error handling.
- Zod validators for digital-product, affiliate-product, lead-form, download-sign inputs.
- Rate limiters on `/api/shop/leads` and download-page email gate.

### Integration

- `/api/shop/checkout` with mixed cart (POD + paid digital): shipping computed on POD only; Stripe line items carry correct `metadata.type`; affiliate rejected.
- Stripe webhook for digital-only order → status `fulfilled_digital`, `shop_order_downloads` rows created, "download ready" email queued.
- Stripe webhook for mixed order → POD stays `paid`; digital lines issue downloads.
- Webhook replay → idempotent (no duplicate download rows).
- `/api/shop/leads` → lead row created, Resend called, email sent; duplicate submission re-sends email with no duplicate row.

### E2E (Playwright)

Three happy paths:

1. Buy mixed cart → Stripe test card → thank-you page → click "Download" for paid PDF → file served → refresh downloads page → count increments.
2. Free PDF flow → submit email → success state → (mock email) → downloads page opens file with valid signed URL.
3. Click affiliate card → `/shop/go/[id]` → 302 lands on `amazon.com` with `tag=` query appended.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Signed-URL leakage (shared publicly) | Short TTL (admin-configured, default 15 min), per-download increment, max-download cap |
| Firebase private bucket misconfiguration leaks files | Separate bucket with explicit "no public access" IAM policy; never write public URLs; integration test asserts public access fails |
| Customer clears email, loses access | Order lookup + email challenge reissues the downloads page; admin can also extend access via order detail |
| Large PDF upload times out server | Direct-to-Firebase signed-upload URL pattern; server receives only the storage path |
| Amazon tag overwritten by an already-tagged URL | `buildAffiliateUrl` strips any existing `tag=` query param before appending `AMAZON_ASSOCIATES_TAG` |
| Redirect route becomes an SEO issue | `/shop/go/[id]` sets `X-Robots-Tag: noindex`; card `<a>` uses `rel="nofollow sponsored noopener"` |
| Resend audience fails silently | `shop_leads.resend_sync_status` tracked; failures visible on leads page with retry button |
| Mixed-cart thank-you confuses customer ("where's my shirt?") | Thank-you page clearly separates "Your downloads" from "Shipping to you" sections |
| Digital refund without revoking leaves downloads live | Admin order detail uses single "Refund + revoke downloads" combined action |
| `fulfilled_digital` added mid-flight breaks existing `ShopOrderStatus` switch statements | Migration runs before code deploy; TypeScript exhaustiveness checks catch unhandled cases at build |

## Rollout Sequence

1. Migrations (product types, files, downloads, leads, affiliate clicks) + DAL + Zod validators.
2. `lib/shop/downloads.ts`, `lib/shop/amazon.ts`, `lib/shop/resend-audience.ts` + unit tests.
3. Admin: digital product create/edit + file manager. Test via admin only (public still blocked by flag).
4. Admin: affiliate product create/edit + click stats.
5. Admin: leads page + CSV export.
6. Public: PDP branching by `product_type`; `/shop/go/[id]`; `/shop/orders/[n]/downloads` page.
7. API extensions: `/api/shop/checkout` type routing, `/api/shop/leads`, `/api/shop/downloads/sign`, `/api/uploads/shop-pdf`.
8. Stripe webhook extension — digital fulfillment branch. E2E with Stripe test cards + sandbox Firebase bucket.
9. Admin order detail digital-fulfillment panel.
10. Seed one free digital, one paid digital, one affiliate product in staging. Internal end-to-end test.
11. Flip `SHOP_AFFILIATE_ENABLED=true` first (lower risk — no money, no files).
12. Flip `SHOP_DIGITAL_ENABLED=true` after one real internal staff digital purchase is verified end-to-end.
