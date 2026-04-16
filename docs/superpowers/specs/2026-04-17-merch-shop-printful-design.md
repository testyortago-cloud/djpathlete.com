# Merch Shop with Printful POD — v1 Design

**Date:** 2026-04-17
**Status:** Approved for implementation planning
**Reference:** Printful API docs — https://developers.printful.com/docs/

## Goal

Replace the current iframe-embedded Yortago shop (`app/(marketing)/shop/page.tsx`) with a fully owned, admin-controlled merch shop powered by Printful print-on-demand fulfillment and the existing Stripe payments stack. Centralizes product management, order tracking, and payments inside the DJP Athlete admin.

## Scope

**v1 includes:** Printful POD physical products only.
**v1 excludes (phase 2+):** digital PDF downloads, Amazon affiliate links, discount codes, multi-currency, product reviews, wishlists, abandoned cart emails, carrier delivery tracking.

## Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Scope | POD merch only in v1 | Nail the hardest integration first; affiliate + digital PDFs layer on later with minimal rework |
| 2 | Printful sync direction | Pull from Printful | Printful dashboard has best artwork/mockup tools; avoid rebuilding design tooling |
| 3 | Checkout UX | Cart-based (multi-item) | Merch shoppers expect cart; combines shipping cost into one order |
| 4 | Auth at checkout | Guest default; auto-link for logged-in users | Low friction for new customers; better UX for returning clients |
| 5 | Shipping | Exact quote from Printful API | Accurate costs prevent margin loss and price surprises |
| 6 | Tax | None in v1 (prices include margin) | Stripe Tax adds complexity; revisit when volume warrants |
| 7 | Fulfillment | Auto-create Printful draft, admin confirms manually | Human checkpoint catches issues at launch; flip to fully auto later |
| 8 | Customer comms | Email (Resend) + public order-lookup page | Reduces "where's my order?" tickets |
| 9 | Catalog structure | Flat grid with featured flag | <20 SKUs expected; categories premature |
| 10 | Rollout | Feature flag `SHOP_ENABLED` | Safe live-money integration testing before public launch |
| 11 | Images | Printful CDN default + optional Firebase upload override | Printful mockups for 90%; lifestyle photos when wanted |
| 12 | Pricing source of truth | Printful dashboard (sync overwrites retail price) | Avoid price drift between two systems |

## Architecture

### New public routes (`app/(marketing)/`)

| Route | Type | Purpose |
|---|---|---|
| `shop/page.tsx` | Server | Product grid; "Coming Soon" when flag off |
| `shop/[slug]/page.tsx` | Server + client island | Product detail with variant picker |
| `shop/cart/page.tsx` | Client | Cart review (localStorage-backed) |
| `shop/checkout/page.tsx` | Client | Address form + shipping quote + Stripe redirect |
| `shop/orders/[orderNumber]/page.tsx` | Server | Public order lookup (email gate) |
| `shop/orders/[orderNumber]/thank-you/page.tsx` | Server | Post-checkout success page |

### New admin routes (`app/(admin)/admin/shop/`)

| Route | Purpose |
|---|---|
| `products/page.tsx` | List, sort, featured/active toggles, sync button |
| `products/[id]/page.tsx` | Detail + edit (description, image overrides, visibility) |
| `orders/page.tsx` | List with status tabs, filters, stats |
| `orders/[id]/page.tsx` | Detail, confirm/cancel/refund actions, timeline, notes |

### New API routes (`app/api/`)

| Route | Method | Purpose |
|---|---|---|
| `shop/sync` | POST | Admin-only; pull catalog from Printful and upsert |
| `shop/quote` | POST | Shipping rate from Printful for `{ items, address }` |
| `shop/checkout` | POST | Create shop_orders draft + Stripe session |
| `shop/orders/[orderNumber]/lookup` | POST | Email-gated public order status (rate-limited) |
| `shop/webhooks/printful` | POST | Handle Printful `package_shipped`, `order_updated`, `order_failed` |
| `uploads/shop` | POST | Admin-only Firebase Storage upload for image overrides |
| `stripe/webhook` (existing, extended) | POST | Add `type: "shop_order"` branch to `checkout.session.completed` |

### New libraries (`lib/`)

| Path | Purpose |
|---|---|
| `lib/printful.ts` | Printful API client — mirrors shape of `lib/stripe.ts` |
| `lib/db/shop-products.ts` | DAL for `shop_products` |
| `lib/db/shop-variants.ts` | DAL for `shop_product_variants` |
| `lib/db/shop-orders.ts` | DAL for `shop_orders` |
| `lib/validators/shop.ts` | Zod schemas (product, variant, order, cart item, address) |
| `lib/shop/cart.ts` | Client-side cart state hook (localStorage-backed) |
| `lib/shop/order-number.ts` | Order number generator (e.g., `DJP-1042`) |
| `lib/shop/emails.ts` | Resend transactional templates (5 emails) |

## Data Model

Single migration file: `supabase/migrations/000NN_create_shop_tables.sql`

### `shop_products`

One row per Printful sync product.

```
id                        uuid PK
printful_sync_id          bigint unique
slug                      text unique                -- auto-generated first sync, immutable
name                      text
description               text                       -- admin-editable, not overwritten by sync
thumbnail_url             text                       -- Printful mockup URL (overwritten by sync)
thumbnail_url_override    text nullable              -- Firebase Storage URL, wins if set
is_active                 boolean default false      -- admin toggle
is_featured               boolean default false      -- pins to top of grid
sort_order                integer default 0
last_synced_at            timestamptz
created_at                timestamptz default now()
updated_at                timestamptz default now()
```

### `shop_product_variants`

One row per Printful sync variant (size/color combination).

```
id                          uuid PK
product_id                  uuid FK → shop_products ON DELETE CASCADE
printful_sync_variant_id    bigint unique
printful_variant_id         bigint                   -- catalog variant id, used for order creation
sku                         text
name                        text                     -- "Black / L"
size                        text nullable
color                       text nullable
retail_price_cents          integer                  -- always overwritten by sync
printful_cost_cents         integer                  -- reference only
mockup_url                  text
mockup_url_override         text nullable
is_available                boolean default true     -- false if removed from Printful
created_at                  timestamptz default now()
updated_at                  timestamptz default now()
```

### `shop_orders`

One row per checkout.

```
id                          uuid PK
order_number                text unique              -- "DJP-1042"
user_id                     uuid FK → users nullable
customer_email              text
customer_name               text
shipping_address            jsonb                    -- {line1, line2, city, state, country, postal, phone}
stripe_session_id           text unique
stripe_payment_intent_id    text nullable
printful_order_id           bigint nullable
status                      shop_order_status
items                       jsonb                    -- [{variant_id, name, qty, unit_price_cents}]
subtotal_cents              integer
shipping_cents              integer
total_cents                 integer
tracking_number             text nullable
tracking_url                text nullable
carrier                     text nullable
refund_amount_cents         integer nullable
notes                       text nullable
created_at                  timestamptz default now()
updated_at                  timestamptz default now()
shipped_at                  timestamptz nullable
```

### New enum in `types/database.ts`

```
ShopOrderStatus = "pending" | "paid" | "draft" | "confirmed" | "in_production" | "shipped" | "canceled" | "refunded"
```

### RLS

- `shop_products` and `shop_product_variants`: public `SELECT` when `is_active = true` (products) and `is_available = true` (variants). Service role full access.
- `shop_orders`: service role full access. No public policy. Public order lookup happens through an API route that verifies `order_number + customer_email` server-side.

### Design notes

- Order items stored as `jsonb` (not a separate table) — items are immutable after creation and match the existing `metadata` jsonb pattern used elsewhere in the schema.
- `retail_price_cents` lives on the variant because Printful sync variants can have different prices per size in the same product.
- `slug` is locked at first sync to protect SEO URLs.
- Unavailable variants are soft-deleted (`is_available = false`) to preserve historical order references.

## Printful Sync Flow

One-way pull, admin-triggered. No automatic cron in v1.

### Algorithm (`app/api/shop/sync/route.ts`, admin-only)

1. `GET https://api.printful.com/store/products` → list of sync products.
2. For each sync product: `GET /store/products/{id}` → full detail with variants.
3. Upsert `shop_products` by `printful_sync_id`:
   - Insert: `is_active = false` (admin activates manually).
   - Update: overwrite `name`, `thumbnail_url`, `last_synced_at`. Do NOT overwrite `description`, `slug`, `thumbnail_url_override`, `is_active`, `is_featured`, `sort_order`.
4. Upsert each variant by `printful_sync_variant_id`:
   - Overwrite `name`, `size`, `color`, `sku`, `retail_price_cents`, `printful_cost_cents`, `printful_variant_id`, `mockup_url`.
   - Do NOT overwrite `mockup_url_override`.
5. Any `shop_product_variants` row whose `printful_sync_variant_id` is not in the response → set `is_available = false`. Never hard-delete.
6. Return summary: `{ added: N, updated: N, deactivated_variants: N }`. Displayed as admin toast.

### Rate limit handling

Printful default is 120 req/min. Sync iterates sequentially and displays progress. For catalogs growing past ~100 products, a chunked background-job variant can be added later.

## Customer Purchase Flow

```
/shop → /shop/[slug] → /shop/cart → /shop/checkout → Stripe → thank-you → email
```

1. **Grid** — fetches active products, sorts by `is_featured DESC, sort_order ASC, created_at DESC`. Cards show resolved image (`thumbnail_url_override ?? thumbnail_url`), name, "From $X" (min variant price).
2. **PDP** — server-rendered for SEO + initial product data; client island handles variant picker and "Add to Cart".
3. **Cart** — `useCart()` hook with localStorage key `djp_shop_cart` holds `[{variant_id, quantity}]`. Cart page validates items against DB on mount; any `is_available=false` item is flagged for removal.
4. **Checkout step A** — shipping address form (Zod-validated). If logged in, pre-fill from user profile.
5. **Checkout step B** — POST `/api/shop/quote` with `{items, address}`. Server calls Printful `POST /shipping/rates`, returns cheapest rate. Display subtotal + shipping + total. "Pay with Stripe" button.
6. **Checkout submit** — POST `/api/shop/checkout`:
   - Re-validate item availability (fail with 409 if any variant became unavailable).
   - Create `shop_orders` row with `status = "pending"`, generate `order_number`.
   - Create Stripe Checkout Session with ad-hoc `price_data` line items (no Stripe product mirroring) and one `shipping_options` entry for the quoted Printful shipping cost.
   - Metadata: `{ type: "shop_order", order_id, order_number }`.
   - Redirect to Stripe.
7. **Stripe success redirect** — `/shop/orders/[orderNumber]/thank-you?session_id=...`. Server verifies session matches order, renders confirmation.
8. **Stripe webhook** (existing `app/api/stripe/webhook/route.ts`, extended) — on `checkout.session.completed` with `metadata.type === "shop_order"`:
   - Update order status `pending → paid`.
   - Store `stripe_payment_intent_id`.
   - Send "Order received" email via Resend.
   - Does NOT call Printful. Admin confirms manually.
9. **Public order lookup** (`/shop/orders/[orderNumber]`) — small form, email gate. Server-side match of `order_number + customer_email` via API route. Rate-limited: 5 attempts per 10 min per order_number.

### Error handling

| Case | Handling |
|---|---|
| Shipping quote fails | Show error, let user edit address or contact support |
| Variant unavailable between quote and checkout | Checkout API returns 409; cart page shows remove prompt |
| Stripe session expires (24h) | Pending orders older than 25h auto-canceled by cleanup step in next sync call |
| Stripe webhook fires twice | Idempotency by `stripe_session_id` — status check before update |

## Admin Shop Management

### Products list (`/admin/shop/products`)

- **Stats:** total products, active count, featured count, last sync timestamp.
- **Actions:** "Sync from Printful" button, drag handles for `sort_order` (via `@dnd-kit`).
- **Table:** thumbnail, name, variant count, price range, status badge, featured star, last synced, row actions (toggle active, toggle featured, edit, view public).

### Product detail (`/admin/shop/products/[id]`)

- Identity: name (read-only from Printful), slug (read-only), description (TipTap rich text editor, admin-editable).
- Images: current thumbnail (Printful or override), upload override button → Firebase Storage via `/api/uploads/shop`.
- Variants: read-only table (size, color, SKU, Printful cost, retail price, available). Only `mockup_url_override` per variant is editable here.
- Visibility: `is_active`, `is_featured` toggles.
- Meta: last synced, Printful sync ID, created/updated.
- No delete action — admin toggles `is_active = false` instead.

### Orders list (`/admin/shop/orders`)

- **Stats:** orders today, pending confirmation (status=`paid`), in production, shipped this week, all-time revenue.
- **Filter tabs:** All / Needs Action (`paid`) / In Production (`confirmed`, `in_production`) / Shipped (`shipped`) / Issues (`canceled`, `refunded`).
- **Default sort:** `status='paid'` first (needs admin attention), then newest.
- **Columns:** order number, customer, items summary, total, status badge, age, actions.

### Order detail (`/admin/shop/orders/[id]`)

- Customer block (name, email, shipping address, linked user if any).
- Items block (thumbnails, variant name, qty, unit price, line total).
- Totals block (subtotal, shipping, total, refunded if any).
- Timeline (status transitions with timestamps).
- Tracking block when available (carrier, number, link).
- Admin notes (free text, saved on blur).
- **State-gated actions:**
  - **Confirm to Printful** — visible when `status = "paid"`. Calls Printful `POST /orders` (with `confirm=false` → draft), stores `printful_order_id`, then `POST /orders/{id}/confirm`. Status → `confirmed`. On failure: stays `paid`, error displayed, retry button appears.
  - **Cancel** — visible when `status ∈ {paid, draft}`. Calls Printful `DELETE /orders/{id}` if draft exists, refunds Stripe in full, status → `canceled`.
  - **Refund** — visible when `status ∈ {confirmed, in_production, shipped}`. Modal for full or partial amount. Calls Stripe refund API. Does NOT cancel Printful order (too late to recover Printful cost). Warns admin clearly. Status → `refunded` on full refund.

### Printful webhook (`app/api/shop/webhooks/printful/route.ts`)

Handles:
- `package_shipped` — store `tracking_number`, `tracking_url`, `carrier`, set `shipped_at`, status → `shipped`. Send "Shipped" email.
- `order_updated` — generic status refresh; only advance status forward.
- `order_failed` — log + admin alert; status stays at current value, admin notes appended.

Signature verification via Printful HMAC; idempotency by `printful_order_id + event_id`.

### Email templates (Resend)

Five HTML + plaintext templates in `lib/shop/emails.ts`:

1. `order-received.tsx` — on `paid`. Order summary, lookup link.
2. `order-confirmed.tsx` — on admin `confirmed`. "Your order is in production."
3. `order-shipped.tsx` — on Printful `package_shipped`. Tracking info.
4. `order-canceled.tsx` — on admin `canceled`. Refund confirmation.
5. `order-refunded.tsx` — on admin `refunded`. Refunded amount.

## Feature Flag

`SHOP_ENABLED` env var (string, checked against `"true"`).

- Public `/shop/page.tsx`: when false, renders "Coming Soon" card instead of product grid. All other public shop routes return 404.
- Admin `/admin/shop/*`: always accessible regardless of flag.
- Stripe and Printful webhooks: always active (so in-flight orders aren't lost if the flag is toggled off mid-launch).

## Testing Strategy

### Unit (Vitest, in `__tests__/`)

- DAL CRUD and edge cases for `shop-products`, `shop-variants`, `shop-orders`.
- Zod validators against fixtures.
- `lib/printful.ts` — mock `fetch` globally, assert request shape and error mapping.
- `lib/shop/cart.ts` — localStorage hook (add, remove, qty, validate-against-DB).
- Order number generator — uniqueness under concurrent creation.
- Webhook handlers — signature verification, idempotency on replay.

### Integration

- Printful sync: mock Printful responses, verify upsert logic, unavailable-variant marking, admin-customized fields preserved.
- Checkout → Stripe webhook → status transition.

### E2E (Playwright, `__tests__/e2e/`)

One happy path:
browse grid → PDP → add to cart → checkout with test address (mock `/api/shop/quote`) → Stripe test card → thank-you page renders.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Printful API rate limits (120/min) | Sequential sync with progress UI; chunking strategy if catalog grows |
| Stripe session expires without webhook | Cleanup step in `/api/shop/sync` cancels `pending` orders > 25h old |
| Printful draft created but confirm failed | Order stuck at `draft`; retry button calls only confirm endpoint, not recreate |
| Double-click on "Confirm to Printful" | Status check before action + DB row lock (CAS on `updated_at`) |
| Webhook replay / out-of-order events | HMAC verification; advance status forward only (never regress) |
| Variant unavailable between quote and checkout | Checkout re-validates, returns 409 with clear message |
| Single currency assumption | Lock USD in v1; multi-currency deferred |

## Rollout Sequence

1. Migration + DAL + Printful client + sync endpoint.
2. Admin product list/detail/sync UI.
3. Seed products in Printful dashboard, run sync, verify admin UI.
4. Public shop pages behind `SHOP_ENABLED=false` (iframe embed still serves `/shop`).
5. Checkout + Stripe webhook extension + Printful webhook + order pages (behind flag).
6. Internal end-to-end test with Printful sandbox + Stripe test mode.
7. Switch to Printful live API, run one real staff order, verify shipping label and tracking email.
8. Flip `SHOP_ENABLED=true`, retire iframe page, announce.

## Out of Scope (v1)

- Discount codes and promotions
- Product reviews and ratings
- Wishlist / save for later
- Multi-currency
- Sales tax line items (Stripe Tax deferred)
- Digital PDF downloads (phase 2)
- Amazon affiliate links (phase 2)
- Abandoned cart email sequences
- Inventory tracking (POD is made-to-order)

## Environment Variables (new)

```
PRINTFUL_API_KEY=
PRINTFUL_WEBHOOK_SECRET=
PRINTFUL_STORE_ID=          # if multi-store account
SHOP_ENABLED=false          # flip to true at public launch
```

Existing variables reused: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, Resend, Firebase Storage, Supabase service role.
