# Merch Shop (Printful POD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iframe-embedded Yortago shop at `app/(marketing)/shop/page.tsx` with a fully owned, admin-controlled merch shop powered by Printful POD and the existing Stripe stack.

**Architecture:** Pull-only Printful sync into local DB, cart-based checkout with exact Printful shipping quotes, Stripe Checkout for payments, manual admin "Confirm to Printful" step, public order-lookup page, feature-flagged (`SHOP_ENABLED`) rollout.

**Tech Stack:** Next.js 16 App Router, Supabase PostgreSQL, NextAuth v5, Stripe, Printful API, Resend, Firebase Storage, Zod, TipTap, @dnd-kit, Vitest + Playwright.

**Spec:** [docs/superpowers/specs/2026-04-17-merch-shop-printful-design.md](../specs/2026-04-17-merch-shop-printful-design.md)

**Printful API docs:** https://developers.printful.com/docs/

---

## File Structure

### New files (grouped by responsibility)

**Types & validators**
- `types/database.ts` — extend with `ShopOrderStatus`, `ShopProduct`, `ShopProductVariant`, `ShopOrder` types
- `lib/validators/shop.ts` — Zod schemas

**Data layer**
- `supabase/migrations/000NN_create_shop_tables.sql`
- `lib/db/shop-products.ts`
- `lib/db/shop-variants.ts`
- `lib/db/shop-orders.ts`

**External integrations**
- `lib/printful.ts` — API client
- `lib/shop/order-number.ts` — human-readable order number generator
- `lib/shop/cart.ts` — client-side cart hook
- `lib/shop/emails.ts` — Resend senders
- `lib/shop/emails/order-received.tsx` — template
- `lib/shop/emails/order-confirmed.tsx`
- `lib/shop/emails/order-shipped.tsx`
- `lib/shop/emails/order-canceled.tsx`
- `lib/shop/emails/order-refunded.tsx`
- `lib/shop/feature-flag.ts` — `SHOP_ENABLED` helper

**API routes**
- `app/api/shop/sync/route.ts`
- `app/api/shop/quote/route.ts`
- `app/api/shop/checkout/route.ts`
- `app/api/shop/orders/[orderNumber]/lookup/route.ts`
- `app/api/shop/webhooks/printful/route.ts`
- `app/api/uploads/shop/route.ts`

**Existing files modified**
- `app/api/stripe/webhook/route.ts` — add `shop_order` branch
- `.env.example` — add Printful + feature flag vars
- `components/admin/Sidebar.tsx` (or equivalent) — add Shop nav entry

**Admin pages**
- `app/(admin)/admin/shop/products/page.tsx`
- `app/(admin)/admin/shop/products/[id]/page.tsx`
- `app/(admin)/admin/shop/products/ShopProductsTable.tsx`
- `app/(admin)/admin/shop/products/SyncButton.tsx`
- `app/(admin)/admin/shop/orders/page.tsx`
- `app/(admin)/admin/shop/orders/[id]/page.tsx`
- `app/(admin)/admin/shop/orders/ShopOrdersTable.tsx`
- `app/(admin)/admin/shop/orders/OrderActions.tsx`

**Public pages**
- `app/(marketing)/shop/page.tsx` — replace iframe with grid (feature-gated)
- `app/(marketing)/shop/[slug]/page.tsx`
- `app/(marketing)/shop/cart/page.tsx`
- `app/(marketing)/shop/checkout/page.tsx`
- `app/(marketing)/shop/orders/[orderNumber]/page.tsx`
- `app/(marketing)/shop/orders/[orderNumber]/thank-you/page.tsx`
- `components/public/shop/ProductCard.tsx`
- `components/public/shop/VariantPicker.tsx`
- `components/public/shop/CartSummary.tsx`

**Tests**
- `__tests__/lib/shop/order-number.test.ts`
- `__tests__/lib/shop/cart.test.ts`
- `__tests__/lib/printful.test.ts`
- `__tests__/lib/db/shop-products.test.ts`
- `__tests__/lib/db/shop-variants.test.ts`
- `__tests__/lib/db/shop-orders.test.ts`
- `__tests__/lib/validators/shop.test.ts`
- `__tests__/api/shop/sync.test.ts`
- `__tests__/api/shop/checkout.test.ts`
- `__tests__/api/shop/webhooks/printful.test.ts`
- `__tests__/e2e/shop-happy-path.spec.ts`

---

## Conventions used throughout

- **DAL pattern:** follow [lib/db/payments.ts](../../../lib/db/payments.ts) — `getClient()` returns `createServiceRoleClient()`, functions throw on error, cast return types.
- **Validator pattern:** follow [lib/validators/checkout.ts](../../../lib/validators/checkout.ts) — named schema + `z.infer` type export.
- **Admin list pattern:** follow [app/(admin)/admin/blog/page.tsx](../../../app/(admin)/admin/blog/page.tsx) — server component top-level fetch, stats card grid above, child client component for table/tabs.
- **Admin auth:** every `/api/admin/*` or admin action checks `const session = await auth(); if (!session?.user?.id || session.user.role !== "admin") return 403`.
- **Stripe pattern:** follow [lib/stripe.ts](../../../lib/stripe.ts) — metadata.type discriminates checkout intent.
- **Test pattern:** Vitest, imports `describe, it, expect, vi` from "vitest". Mock `fetch` globally for external APIs. Testing Library for component tests.
- **Commit after every task.** Use conventional commit prefixes: `feat(shop):`, `test(shop):`, `fix(shop):`, `chore(shop):`.

---

## Task 1: Environment variables and feature flag helper

**Files:**
- Modify: `.env.example`
- Create: `lib/shop/feature-flag.ts`
- Create: `__tests__/lib/shop/feature-flag.test.ts`

- [ ] **Step 1.1: Add env vars to `.env.example`**

Append to `.env.example`:

```
# Printful
PRINTFUL_API_KEY=
PRINTFUL_WEBHOOK_SECRET=
PRINTFUL_STORE_ID=

# Shop
SHOP_ENABLED=false
```

- [ ] **Step 1.2: Write failing test for feature flag helper**

Create `__tests__/lib/shop/feature-flag.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isShopEnabled } from "@/lib/shop/feature-flag"

describe("isShopEnabled", () => {
  const originalEnv = process.env.SHOP_ENABLED

  afterEach(() => {
    process.env.SHOP_ENABLED = originalEnv
  })

  it("returns false when env var is undefined", () => {
    delete process.env.SHOP_ENABLED
    expect(isShopEnabled()).toBe(false)
  })

  it("returns false when env var is 'false'", () => {
    process.env.SHOP_ENABLED = "false"
    expect(isShopEnabled()).toBe(false)
  })

  it("returns false when env var is any non-'true' value", () => {
    process.env.SHOP_ENABLED = "1"
    expect(isShopEnabled()).toBe(false)
  })

  it("returns true only when env var is exactly 'true'", () => {
    process.env.SHOP_ENABLED = "true"
    expect(isShopEnabled()).toBe(true)
  })
})
```

- [ ] **Step 1.3: Run test, expect failure**

Run: `npm run test:run -- feature-flag`
Expected: FAIL — module not found

- [ ] **Step 1.4: Create the helper**

Create `lib/shop/feature-flag.ts`:

```typescript
export function isShopEnabled(): boolean {
  return process.env.SHOP_ENABLED === "true"
}
```

- [ ] **Step 1.5: Run test, expect pass**

Run: `npm run test:run -- feature-flag`
Expected: PASS (4 tests)

- [ ] **Step 1.6: Commit**

```bash
git add .env.example lib/shop/feature-flag.ts __tests__/lib/shop/feature-flag.test.ts
git commit -m "feat(shop): add SHOP_ENABLED feature flag helper and env vars"
```

---

## Task 2: Database migration for shop tables

**Files:**
- Create: `supabase/migrations/000NN_create_shop_tables.sql` (replace NN with next number — check existing migrations with `ls supabase/migrations/ | tail -3`)
- Modify: `types/database.ts`

- [ ] **Step 2.1: Determine next migration number**

Run: `ls supabase/migrations/ | sort | tail -5`
Note the highest number N. Your file will be `000<N+1>_create_shop_tables.sql`.

- [ ] **Step 2.2: Create migration file**

Contents:

```sql
-- Shop: products, variants, orders (v1 = Printful POD)

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  printful_sync_id bigint unique not null,
  slug text unique not null,
  name text not null,
  description text not null default '',
  thumbnail_url text not null default '',
  thumbnail_url_override text,
  is_active boolean not null default false,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_products_active_sort_idx
  on public.shop_products (is_active, is_featured desc, sort_order asc, created_at desc);

create table if not exists public.shop_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  printful_sync_variant_id bigint unique not null,
  printful_variant_id bigint not null,
  sku text not null,
  name text not null,
  size text,
  color text,
  retail_price_cents integer not null check (retail_price_cents >= 0),
  printful_cost_cents integer not null check (printful_cost_cents >= 0),
  mockup_url text not null default '',
  mockup_url_override text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_variants_product_available_idx
  on public.shop_product_variants (product_id, is_available);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  user_id uuid references public.users(id) on delete set null,
  customer_email text not null,
  customer_name text not null,
  shipping_address jsonb not null,
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  printful_order_id bigint,
  status text not null default 'pending' check (status in (
    'pending', 'paid', 'draft', 'confirmed', 'in_production',
    'shipped', 'canceled', 'refunded'
  )),
  items jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  tracking_number text,
  tracking_url text,
  carrier text,
  refund_amount_cents integer check (refund_amount_cents is null or refund_amount_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz
);

create index if not exists shop_orders_status_created_idx on public.shop_orders (status, created_at desc);
create index if not exists shop_orders_user_idx on public.shop_orders (user_id);
create index if not exists shop_orders_email_idx on public.shop_orders (customer_email);

-- RLS
alter table public.shop_products enable row level security;
alter table public.shop_product_variants enable row level security;
alter table public.shop_orders enable row level security;

create policy "Public can view active products"
  on public.shop_products for select
  using (is_active = true);

create policy "Admins manage all products"
  on public.shop_products for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Public can view available variants"
  on public.shop_product_variants for select
  using (is_available = true and exists (
    select 1 from public.shop_products p where p.id = product_id and p.is_active = true
  ));

create policy "Admins manage all variants"
  on public.shop_product_variants for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create policy "Admins manage all orders"
  on public.shop_orders for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- updated_at triggers
create trigger set_updated_at before update on public.shop_products
  for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.shop_product_variants
  for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.shop_orders
  for each row execute function public.update_updated_at();
```

- [ ] **Step 2.3: Add types to `types/database.ts`**

Append (keeping existing file intact):

```typescript
export type ShopOrderStatus =
  | "pending"
  | "paid"
  | "draft"
  | "confirmed"
  | "in_production"
  | "shipped"
  | "canceled"
  | "refunded"

export interface ShopProduct {
  id: string
  printful_sync_id: number
  slug: string
  name: string
  description: string
  thumbnail_url: string
  thumbnail_url_override: string | null
  is_active: boolean
  is_featured: boolean
  sort_order: number
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface ShopProductVariant {
  id: string
  product_id: string
  printful_sync_variant_id: number
  printful_variant_id: number
  sku: string
  name: string
  size: string | null
  color: string | null
  retail_price_cents: number
  printful_cost_cents: number
  mockup_url: string
  mockup_url_override: string | null
  is_available: boolean
  created_at: string
  updated_at: string
}

export interface ShopOrderItem {
  variant_id: string
  product_id: string
  name: string
  variant_name: string
  thumbnail_url: string
  quantity: number
  unit_price_cents: number
  printful_variant_id: number
}

export interface ShopOrderShippingAddress {
  name: string
  email: string
  phone: string | null
  line1: string
  line2: string | null
  city: string
  state: string
  country: string
  postal_code: string
}

export interface ShopOrder {
  id: string
  order_number: string
  user_id: string | null
  customer_email: string
  customer_name: string
  shipping_address: ShopOrderShippingAddress
  stripe_session_id: string | null
  stripe_payment_intent_id: string | null
  printful_order_id: number | null
  status: ShopOrderStatus
  items: ShopOrderItem[]
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  refund_amount_cents: number | null
  notes: string | null
  created_at: string
  updated_at: string
  shipped_at: string | null
}
```

- [ ] **Step 2.4: Apply migration**

Run: `npx supabase db push` (or equivalent command used in the project — check the `README` or `package.json` `scripts` section).
Expected: migration applies cleanly, no errors.

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations types/database.ts
git commit -m "feat(shop): add shop_products, shop_product_variants, shop_orders tables"
```

---

## Task 3: Zod validators

**Files:**
- Create: `lib/validators/shop.ts`
- Create: `__tests__/lib/validators/shop.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `__tests__/lib/validators/shop.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  shippingAddressSchema,
  cartItemSchema,
  checkoutRequestSchema,
  orderLookupSchema,
} from "@/lib/validators/shop"

describe("shippingAddressSchema", () => {
  const valid = {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+15555551234",
    line1: "123 Main St",
    line2: null,
    city: "Austin",
    state: "TX",
    country: "US",
    postal_code: "78701",
  }

  it("accepts valid address", () => {
    expect(shippingAddressSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects invalid email", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, email: "not-an-email" })
    expect(r.success).toBe(false)
  })

  it("requires country as 2-letter code", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, country: "USA" })
    expect(r.success).toBe(false)
  })

  it("allows nullable phone and line2", () => {
    const r = shippingAddressSchema.safeParse({ ...valid, phone: null, line2: null })
    expect(r.success).toBe(true)
  })
})

describe("cartItemSchema", () => {
  it("requires positive quantity", () => {
    const r = cartItemSchema.safeParse({
      variant_id: "a7f0a5c3-0000-4000-8000-000000000000",
      quantity: 0,
    })
    expect(r.success).toBe(false)
  })

  it("caps quantity at 99", () => {
    const r = cartItemSchema.safeParse({
      variant_id: "a7f0a5c3-0000-4000-8000-000000000000",
      quantity: 100,
    })
    expect(r.success).toBe(false)
  })
})

describe("checkoutRequestSchema", () => {
  it("requires at least one item", () => {
    const r = checkoutRequestSchema.safeParse({
      items: [],
      address: {
        name: "J", email: "j@x.co", phone: null,
        line1: "1 A St", line2: null, city: "A", state: "TX",
        country: "US", postal_code: "78701",
      },
    })
    expect(r.success).toBe(false)
  })
})

describe("orderLookupSchema", () => {
  it("requires email", () => {
    expect(orderLookupSchema.safeParse({}).success).toBe(false)
  })
})
```

- [ ] **Step 3.2: Run tests, expect failure**

Run: `npm run test:run -- validators/shop`
Expected: FAIL — module not found

- [ ] **Step 3.3: Implement validators**

Create `lib/validators/shop.ts`:

```typescript
import { z } from "zod"

const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid UUID"
)

export const shippingAddressSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(30).nullable(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  country: z.string().length(2, "Country must be ISO 2-letter code"),
  postal_code: z.string().min(1).max(20),
})
export type ShippingAddress = z.infer<typeof shippingAddressSchema>

export const cartItemSchema = z.object({
  variant_id: uuid,
  quantity: z.number().int().min(1).max(99),
})
export type CartItem = z.infer<typeof cartItemSchema>

export const shippingQuoteRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  address: shippingAddressSchema,
})
export type ShippingQuoteRequest = z.infer<typeof shippingQuoteRequestSchema>

export const checkoutRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  address: shippingAddressSchema,
  shipping_cents: z.number().int().min(0),
})
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export const orderLookupSchema = z.object({
  email: z.string().email(),
})
export type OrderLookupRequest = z.infer<typeof orderLookupSchema>

export const adminUpdateProductSchema = z.object({
  description: z.string().max(5000).optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  thumbnail_url_override: z.string().url().nullable().optional(),
})
export type AdminUpdateProduct = z.infer<typeof adminUpdateProductSchema>

export const adminUpdateVariantSchema = z.object({
  mockup_url_override: z.string().url().nullable().optional(),
})
export type AdminUpdateVariant = z.infer<typeof adminUpdateVariantSchema>

export const adminRefundSchema = z.object({
  amount_cents: z.number().int().min(1),
  reason: z.string().max(500).optional(),
})
export type AdminRefund = z.infer<typeof adminRefundSchema>
```

- [ ] **Step 3.4: Run tests, expect pass**

Run: `npm run test:run -- validators/shop`
Expected: PASS

- [ ] **Step 3.5: Commit**

```bash
git add lib/validators/shop.ts __tests__/lib/validators/shop.test.ts
git commit -m "feat(shop): add Zod validators for shop address, cart, checkout, and admin actions"
```

---

## Task 4: Order number generator

**Files:**
- Create: `lib/shop/order-number.ts`
- Create: `__tests__/lib/shop/order-number.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `__tests__/lib/shop/order-number.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { generateOrderNumber } from "@/lib/shop/order-number"

describe("generateOrderNumber", () => {
  it("starts with 'DJP-'", () => {
    expect(generateOrderNumber()).toMatch(/^DJP-/)
  })

  it("includes 8+ chars after prefix", () => {
    const n = generateOrderNumber()
    expect(n.length).toBeGreaterThanOrEqual(12)
  })

  it("produces unique values over 500 calls", () => {
    const set = new Set<string>()
    for (let i = 0; i < 500; i++) set.add(generateOrderNumber())
    expect(set.size).toBe(500)
  })

  it("uses only uppercase letters and digits (no ambiguous chars)", () => {
    for (let i = 0; i < 20; i++) {
      const n = generateOrderNumber()
      expect(n.slice(4)).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/)
    }
  })
})
```

- [ ] **Step 4.2: Run test, expect failure**

Run: `npm run test:run -- order-number`

- [ ] **Step 4.3: Implement generator**

Create `lib/shop/order-number.ts`:

```typescript
import { randomBytes } from "node:crypto"

// Crockford-like alphabet: no 0/O/1/I/L to avoid ambiguity
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

export function generateOrderNumber(): string {
  const bytes = randomBytes(8)
  let s = ""
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return `DJP-${s}`
}
```

- [ ] **Step 4.4: Run test, expect pass**

Run: `npm run test:run -- order-number`

- [ ] **Step 4.5: Commit**

```bash
git add lib/shop/order-number.ts __tests__/lib/shop/order-number.test.ts
git commit -m "feat(shop): add order number generator"
```

---

## Task 5: DAL — shop-products

**Files:**
- Create: `lib/db/shop-products.ts`
- Create: `__tests__/lib/db/shop-products.test.ts`

Follow the exact shape of [lib/db/payments.ts](../../../lib/db/payments.ts).

- [ ] **Step 5.1: Write failing tests**

Create `__tests__/lib/db/shop-products.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const fromMock = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}))

import {
  listActiveProducts,
  listAllProducts,
  getProductBySlug,
  getProductById,
  updateProduct,
  upsertProductFromSync,
} from "@/lib/db/shop-products"

function chainable(data: unknown, error: unknown = null) {
  const chain: any = {}
  const methods = ["select", "eq", "order", "insert", "update", "upsert", "single", "limit"]
  methods.forEach((m) => { chain[m] = vi.fn(() => chain) })
  chain.then = (resolve: (v: unknown) => void) => resolve({ data, error })
  chain.single.mockResolvedValue({ data, error })
  return chain
}

beforeEach(() => { fromMock.mockReset() })

describe("shop-products DAL", () => {
  it("listActiveProducts filters by is_active=true sorted by featured/sort_order", async () => {
    const rows = [{ id: "1", name: "Tee", is_active: true }]
    fromMock.mockReturnValueOnce(chainable(rows))
    const result = await listActiveProducts()
    expect(result).toEqual(rows)
    expect(fromMock).toHaveBeenCalledWith("shop_products")
  })

  it("getProductBySlug returns null when not found", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { code: "PGRST116" }))
    const result = await getProductBySlug("missing")
    expect(result).toBeNull()
  })

  it("updateProduct throws on DB error", async () => {
    fromMock.mockReturnValueOnce(chainable(null, { message: "boom" }))
    await expect(updateProduct("id1", { is_active: true })).rejects.toThrow()
  })

  it("upsertProductFromSync preserves is_active/is_featured/sort_order/description", async () => {
    const existing = { id: "p1", is_active: true, is_featured: true, sort_order: 5, description: "custom" }
    fromMock.mockReturnValueOnce(chainable(existing))
    fromMock.mockReturnValueOnce(chainable({ ...existing, name: "New Name" }))

    const result = await upsertProductFromSync({
      printful_sync_id: 12345,
      name: "New Name",
      slug: "new-name",
      thumbnail_url: "http://example.com/thumb.jpg",
    })

    expect(result.is_active).toBe(true)
    expect(result.is_featured).toBe(true)
    expect(result.sort_order).toBe(5)
    expect(result.description).toBe("custom")
  })
})
```

- [ ] **Step 5.2: Run tests, expect failure**

Run: `npm run test:run -- db/shop-products`

- [ ] **Step 5.3: Implement DAL**

Create `lib/db/shop-products.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProduct } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listActiveProducts(): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ShopProduct[]
}

export async function listAllProducts(): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ShopProduct[]
}

export async function getProductBySlug(slug: string): Promise<ShopProduct | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("slug", slug)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function getProductById(id: string): Promise<ShopProduct | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function getProductByPrintfulSyncId(syncId: number): Promise<ShopProduct | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("printful_sync_id", syncId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProduct
}

export async function updateProduct(
  id: string,
  updates: Partial<Omit<ShopProduct, "id" | "created_at">>
): Promise<ShopProduct> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}

interface SyncProductInput {
  printful_sync_id: number
  name: string
  slug: string
  thumbnail_url: string
}

export async function upsertProductFromSync(input: SyncProductInput): Promise<ShopProduct> {
  const existing = await getProductByPrintfulSyncId(input.printful_sync_id)
  const supabase = getClient()
  const now = new Date().toISOString()

  if (existing) {
    const { data, error } = await supabase
      .from("shop_products")
      .update({
        name: input.name,
        thumbnail_url: input.thumbnail_url,
        last_synced_at: now,
      })
      .eq("id", existing.id)
      .select()
      .single()
    if (error) throw error
    return data as ShopProduct
  }

  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      printful_sync_id: input.printful_sync_id,
      slug: input.slug,
      name: input.name,
      description: "",
      thumbnail_url: input.thumbnail_url,
      is_active: false,
      is_featured: false,
      sort_order: 0,
      last_synced_at: now,
    })
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}
```

- [ ] **Step 5.4: Run tests, expect pass**

Run: `npm run test:run -- db/shop-products`

- [ ] **Step 5.5: Commit**

```bash
git add lib/db/shop-products.ts __tests__/lib/db/shop-products.test.ts
git commit -m "feat(shop): add shop-products DAL with sync-preserving upsert"
```

---

## Task 6: DAL — shop-variants

**Files:**
- Create: `lib/db/shop-variants.ts`
- Create: `__tests__/lib/db/shop-variants.test.ts`

- [ ] **Step 6.1: Write failing tests**

Create `__tests__/lib/db/shop-variants.test.ts` mirroring Task 5's test harness. Cover:
- `listVariantsForProduct(productId)` — returns available variants ordered by price asc
- `getVariantById(id)` — returns null when missing
- `getVariantsByIds(ids: string[])` — batch fetch for cart validation
- `upsertVariantFromSync` — preserves `mockup_url_override`
- `markVariantsUnavailable(productId, excludeSyncVariantIds)` — flips `is_available=false` for rows not in the exclude list

(Use the same `chainable(data, error)` helper pattern as Task 5.)

- [ ] **Step 6.2: Implement DAL**

Create `lib/db/shop-variants.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProductVariant } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listVariantsForProduct(productId: string): Promise<ShopProductVariant[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("product_id", productId)
    .eq("is_available", true)
    .order("retail_price_cents", { ascending: true })
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function listAllVariantsForProduct(productId: string): Promise<ShopProductVariant[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("retail_price_cents", { ascending: true })
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function getVariantById(id: string): Promise<ShopProductVariant | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProductVariant
}

export async function getVariantsByIds(ids: string[]): Promise<ShopProductVariant[]> {
  if (ids.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .in("id", ids)
  if (error) throw error
  return (data ?? []) as ShopProductVariant[]
}

export async function getVariantByPrintfulSyncVariantId(syncVariantId: number): Promise<ShopProductVariant | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .select("*")
    .eq("printful_sync_variant_id", syncVariantId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopProductVariant
}

interface SyncVariantInput {
  product_id: string
  printful_sync_variant_id: number
  printful_variant_id: number
  sku: string
  name: string
  size: string | null
  color: string | null
  retail_price_cents: number
  printful_cost_cents: number
  mockup_url: string
}

export async function upsertVariantFromSync(input: SyncVariantInput): Promise<ShopProductVariant> {
  const existing = await getVariantByPrintfulSyncVariantId(input.printful_sync_variant_id)
  const supabase = getClient()

  if (existing) {
    const { data, error } = await supabase
      .from("shop_product_variants")
      .update({
        printful_variant_id: input.printful_variant_id,
        sku: input.sku,
        name: input.name,
        size: input.size,
        color: input.color,
        retail_price_cents: input.retail_price_cents,
        printful_cost_cents: input.printful_cost_cents,
        mockup_url: input.mockup_url,
        is_available: true,
      })
      .eq("id", existing.id)
      .select()
      .single()
    if (error) throw error
    return data as ShopProductVariant
  }

  const { data, error } = await supabase
    .from("shop_product_variants")
    .insert({ ...input, is_available: true })
    .select()
    .single()
  if (error) throw error
  return data as ShopProductVariant
}

export async function markVariantsUnavailable(productId: string, keepSyncVariantIds: number[]): Promise<number> {
  const supabase = getClient()
  let query = supabase
    .from("shop_product_variants")
    .update({ is_available: false })
    .eq("product_id", productId)
    .eq("is_available", true)
  if (keepSyncVariantIds.length > 0) {
    query = query.not("printful_sync_variant_id", "in", `(${keepSyncVariantIds.join(",")})`)
  }
  const { data, error } = await query.select("id")
  if (error) throw error
  return (data ?? []).length
}

export async function updateVariant(
  id: string,
  updates: Partial<Pick<ShopProductVariant, "mockup_url_override">>
): Promise<ShopProductVariant> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .update(updates)
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return data as ShopProductVariant
}
```

- [ ] **Step 6.3: Run tests, expect pass**

Run: `npm run test:run -- db/shop-variants`

- [ ] **Step 6.4: Commit**

```bash
git add lib/db/shop-variants.ts __tests__/lib/db/shop-variants.test.ts
git commit -m "feat(shop): add shop-variants DAL with sync upsert and availability marking"
```

---

## Task 7: DAL — shop-orders

**Files:**
- Create: `lib/db/shop-orders.ts`
- Create: `__tests__/lib/db/shop-orders.test.ts`

- [ ] **Step 7.1: Write failing tests**

Tests must cover:
- `createOrder` — generates `order_number`, returns full `ShopOrder`, retries on unique collision (up to 3 times)
- `getOrderById`
- `getOrderByNumber`
- `getOrderByStripeSessionId`
- `updateOrderStatus` — only advances forward; throws if attempting regression (e.g., `shipped → paid`)
- `listOrders({ status?, limit, offset })`
- `getOrderStats` — returns counts by bucket + today count + week revenue
- `findPendingOrdersOlderThan(hours)` — for cleanup

- [ ] **Step 7.2: Implement DAL**

Create `lib/db/shop-orders.ts`:

```typescript
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopOrder, ShopOrderStatus } from "@/types/database"
import { generateOrderNumber } from "@/lib/shop/order-number"

function getClient() {
  return createServiceRoleClient()
}

const STATUS_ORDER: Record<ShopOrderStatus, number> = {
  pending: 0,
  paid: 1,
  draft: 2,
  confirmed: 3,
  in_production: 4,
  shipped: 5,
  canceled: 90,
  refunded: 91,
}

export function canTransition(from: ShopOrderStatus, to: ShopOrderStatus): boolean {
  if (to === "canceled" || to === "refunded") return true
  return STATUS_ORDER[to] > STATUS_ORDER[from]
}

export async function createOrder(
  input: Omit<ShopOrder, "id" | "order_number" | "created_at" | "updated_at" | "shipped_at" | "stripe_session_id" | "stripe_payment_intent_id" | "printful_order_id" | "tracking_number" | "tracking_url" | "carrier" | "refund_amount_cents" | "shipped_at">
): Promise<ShopOrder> {
  const supabase = getClient()
  for (let attempt = 0; attempt < 3; attempt++) {
    const order_number = generateOrderNumber()
    const { data, error } = await supabase
      .from("shop_orders")
      .insert({ ...input, order_number })
      .select()
      .single()
    if (!error) return data as ShopOrder
    const code = (error as { code?: string }).code
    if (code !== "23505") throw error
  }
  throw new Error("Failed to generate unique order_number after 3 attempts")
}

export async function getOrderById(id: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("shop_orders").select("*").eq("id", id).single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function getOrderByNumber(orderNumber: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("order_number", orderNumber)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function getOrderByStripeSessionId(sessionId: string): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}

export async function updateOrder(
  id: string,
  updates: Partial<Omit<ShopOrder, "id" | "created_at" | "order_number">>
): Promise<ShopOrder> {
  const supabase = getClient()
  const { data, error } = await supabase.from("shop_orders").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as ShopOrder
}

export async function updateOrderStatus(id: string, next: ShopOrderStatus, extra: Partial<ShopOrder> = {}): Promise<ShopOrder> {
  const current = await getOrderById(id)
  if (!current) throw new Error(`Order ${id} not found`)
  if (current.status === next) return current
  if (!canTransition(current.status, next)) {
    throw new Error(`Invalid status transition: ${current.status} → ${next}`)
  }
  return updateOrder(id, { status: next, ...extra })
}

export async function listOrders(opts: { status?: ShopOrderStatus | ShopOrderStatus[]; limit?: number; offset?: number } = {}): Promise<ShopOrder[]> {
  const supabase = getClient()
  let query = supabase.from("shop_orders").select("*").order("created_at", { ascending: false })
  if (Array.isArray(opts.status)) query = query.in("status", opts.status)
  else if (opts.status) query = query.eq("status", opts.status)
  if (opts.limit) query = query.limit(opts.limit)
  if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ShopOrder[]
}

export async function findPendingOrdersOlderThan(hours: number): Promise<ShopOrder[]> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("status", "pending")
    .lt("created_at", cutoff)
  if (error) throw error
  return (data ?? []) as ShopOrder[]
}

export async function getOrderStats(): Promise<{
  today: number
  needs_action: number
  in_production: number
  shipped_this_week: number
  revenue_all_time_cents: number
}> {
  const supabase = getClient()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7)

  const [{ count: today }, { count: needs_action }, { count: in_production }, { count: shipped_this_week }, revenueRes] = await Promise.all([
    supabase.from("shop_orders").select("*", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    supabase.from("shop_orders").select("*", { count: "exact", head: true }).eq("status", "paid"),
    supabase.from("shop_orders").select("*", { count: "exact", head: true }).in("status", ["confirmed", "in_production"]),
    supabase.from("shop_orders").select("*", { count: "exact", head: true }).eq("status", "shipped").gte("shipped_at", weekStart.toISOString()),
    supabase.from("shop_orders").select("total_cents").in("status", ["paid", "confirmed", "in_production", "shipped"]),
  ])
  if (revenueRes.error) throw revenueRes.error
  const revenue_all_time_cents = (revenueRes.data ?? []).reduce((sum, r) => sum + (r.total_cents ?? 0), 0)

  return {
    today: today ?? 0,
    needs_action: needs_action ?? 0,
    in_production: in_production ?? 0,
    shipped_this_week: shipped_this_week ?? 0,
    revenue_all_time_cents,
  }
}
```

- [ ] **Step 7.3: Run tests, expect pass**

Run: `npm run test:run -- db/shop-orders`

- [ ] **Step 7.4: Commit**

```bash
git add lib/db/shop-orders.ts __tests__/lib/db/shop-orders.test.ts
git commit -m "feat(shop): add shop-orders DAL with status transition guard and stats"
```

---

## Task 8: Printful API client

**Files:**
- Create: `lib/printful.ts`
- Create: `__tests__/lib/printful.test.ts`

Ref: https://developers.printful.com/docs/

- [ ] **Step 8.1: Write failing tests**

Create `__tests__/lib/printful.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { listSyncProducts, getSyncProduct, getShippingRates, createOrder, confirmOrder, cancelOrder, verifyWebhookSignature } from "@/lib/printful"

const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn()
  process.env.PRINTFUL_API_KEY = "test_key"
  process.env.PRINTFUL_WEBHOOK_SECRET = "test_secret"
})
afterAll(() => { global.fetch = originalFetch })

describe("Printful client", () => {
  it("listSyncProducts calls GET /store/products with bearer auth", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ result: [{ id: 1, name: "Tee" }] })))
    const result = await listSyncProducts()
    expect(result).toEqual([{ id: 1, name: "Tee" }])
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toContain("/store/products")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test_key")
  })

  it("throws a PrintfulError on non-2xx with error payload", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 })
    )
    await expect(listSyncProducts()).rejects.toMatchObject({ status: 400, message: expect.stringContaining("nope") })
  })

  it("getShippingRates POSTs recipient + items and returns rates", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [{ id: "STANDARD", rate: "4.99", name: "Flat" }] }))
    )
    const rates = await getShippingRates({ recipient: { country_code: "US", zip: "78701" } as any, items: [{ variant_id: 1, quantity: 1 }] })
    expect(rates[0].id).toBe("STANDARD")
  })

  it("verifyWebhookSignature rejects bad HMAC", () => {
    expect(verifyWebhookSignature("payload", "wrong-sig")).toBe(false)
  })
})
```

- [ ] **Step 8.2: Run tests, expect failure**

Run: `npm run test:run -- lib/printful`

- [ ] **Step 8.3: Implement client**

Create `lib/printful.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto"

const BASE = "https://api.printful.com"

export class PrintfulError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message); this.status = status; this.code = code
  }
}

function headers(): Record<string, string> {
  const key = process.env.PRINTFUL_API_KEY
  if (!key) throw new Error("PRINTFUL_API_KEY not set")
  const h: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  }
  if (process.env.PRINTFUL_STORE_ID) h["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID
  return h
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.result ?? `Printful ${res.status}`
    throw new PrintfulError(res.status, msg, body?.code)
  }
  return body.result as T
}

export interface SyncProductSummary {
  id: number
  external_id: string
  name: string
  variants: number
  synced: number
  thumbnail_url: string
}

export interface SyncVariant {
  id: number
  external_id: string
  sync_product_id: number
  name: string
  variant_id: number
  retail_price: string
  currency: string
  sku: string
  product: { image: string; name: string }
  files: Array<{ type: string; preview_url: string }>
  options: Array<{ id: string; value: string }>
  is_ignored: boolean
}

export interface SyncProductDetail {
  sync_product: SyncProductSummary
  sync_variants: SyncVariant[]
}

export interface ShippingRate {
  id: string
  name: string
  rate: string
  currency: string
  minDeliveryDays?: number
  maxDeliveryDays?: number
}

export interface PrintfulRecipient {
  name: string
  address1: string
  address2?: string | null
  city: string
  state_code: string
  country_code: string
  zip: string
  phone?: string | null
  email: string
}

export interface PrintfulOrderItemInput {
  sync_variant_id?: number
  variant_id?: number
  quantity: number
  retail_price?: string
}

export interface PrintfulOrder {
  id: number
  external_id: string
  status: string
  shipping: string
  recipient: PrintfulRecipient
  items: Array<{ id: number; sync_variant_id?: number; variant_id: number; quantity: number; name: string }>
  retail_costs: { subtotal: string; shipping: string; total: string; currency: string }
}

export async function listSyncProducts(): Promise<SyncProductSummary[]> {
  return request<SyncProductSummary[]>("/store/products")
}

export async function getSyncProduct(id: number): Promise<SyncProductDetail> {
  return request<SyncProductDetail>(`/store/products/${id}`)
}

export async function getShippingRates(opts: {
  recipient: PrintfulRecipient
  items: Array<{ variant_id?: number; sync_variant_id?: number; quantity: number }>
}): Promise<ShippingRate[]> {
  return request<ShippingRate[]>("/shipping/rates", {
    method: "POST",
    body: JSON.stringify({ recipient: opts.recipient, items: opts.items }),
  })
}

export async function createOrder(opts: {
  external_id: string
  recipient: PrintfulRecipient
  items: PrintfulOrderItemInput[]
  retail_costs?: { currency?: string; subtotal?: string; shipping?: string; total?: string }
  shipping?: string
}): Promise<PrintfulOrder> {
  return request<PrintfulOrder>("/orders?confirm=false", {
    method: "POST",
    body: JSON.stringify(opts),
  })
}

export async function confirmOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}/confirm`, { method: "POST" })
}

export async function cancelOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}`, { method: "DELETE" })
}

export async function getOrder(printfulOrderId: number): Promise<PrintfulOrder> {
  return request<PrintfulOrder>(`/orders/${printfulOrderId}`)
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.PRINTFUL_WEBHOOK_SECRET
  if (!secret) throw new Error("PRINTFUL_WEBHOOK_SECRET not set")
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}
```

- [ ] **Step 8.4: Run tests, expect pass**

Run: `npm run test:run -- lib/printful`

- [ ] **Step 8.5: Commit**

```bash
git add lib/printful.ts __tests__/lib/printful.test.ts
git commit -m "feat(shop): add Printful API client with sync, shipping, orders, webhook verify"
```

---

## Task 9: Admin sync endpoint

**Files:**
- Create: `app/api/shop/sync/route.ts`
- Create: `__tests__/api/shop/sync.test.ts`
- Create: `lib/shop/sync.ts` (pure business logic, independent of the route)

Separating sync logic from the route makes it independently testable.

- [ ] **Step 9.1: Write failing tests for `lib/shop/sync.ts`**

Test file asserts:
- Calls `listSyncProducts` then `getSyncProduct` for each
- Calls `upsertProductFromSync` with correct name/slug/thumbnail per product
- Calls `upsertVariantFromSync` for each sync variant with correct cost/price mapping (Printful returns price as string dollars, we convert to cents)
- Calls `markVariantsUnavailable` with list of current sync variant IDs per product
- Returns summary `{ added, updated, deactivated_variants }`

Mock `lib/printful`, `lib/db/shop-products`, `lib/db/shop-variants`.

- [ ] **Step 9.2: Implement `lib/shop/sync.ts`**

```typescript
import { getSyncProduct, listSyncProducts, type SyncVariant } from "@/lib/printful"
import { getProductByPrintfulSyncId, upsertProductFromSync } from "@/lib/db/shop-products"
import { markVariantsUnavailable, upsertVariantFromSync } from "@/lib/db/shop-variants"

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product"
}

function dollarsToCents(s: string): number {
  return Math.round(parseFloat(s) * 100)
}

function extractSizeColor(variant: SyncVariant): { size: string | null; color: string | null } {
  const size = variant.options.find((o) => o.id === "size")?.value ?? null
  const color = variant.options.find((o) => o.id === "color")?.value ?? null
  return { size, color }
}

export interface SyncResult {
  added: number
  updated: number
  deactivated_variants: number
}

export async function syncPrintfulCatalog(): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, deactivated_variants: 0 }
  const summaries = await listSyncProducts()

  for (const summary of summaries) {
    const detail = await getSyncProduct(summary.id)
    const existing = await getProductByPrintfulSyncId(summary.id)

    const product = await upsertProductFromSync({
      printful_sync_id: summary.id,
      name: summary.name,
      slug: existing?.slug ?? slugify(summary.name),
      thumbnail_url: summary.thumbnail_url,
    })

    if (existing) result.updated += 1
    else result.added += 1

    const keepIds: number[] = []
    for (const v of detail.sync_variants) {
      if (v.is_ignored) continue
      const { size, color } = extractSizeColor(v)
      await upsertVariantFromSync({
        product_id: product.id,
        printful_sync_variant_id: v.id,
        printful_variant_id: v.variant_id,
        sku: v.sku,
        name: v.name,
        size,
        color,
        retail_price_cents: dollarsToCents(v.retail_price),
        printful_cost_cents: 0,
        mockup_url: v.files.find((f) => f.type === "preview")?.preview_url ?? v.product.image ?? "",
      })
      keepIds.push(v.id)
    }
    result.deactivated_variants += await markVariantsUnavailable(product.id, keepIds)
  }
  return result
}
```

- [ ] **Step 9.3: Run sync tests, expect pass**

Run: `npm run test:run -- shop/sync`

- [ ] **Step 9.4: Write failing test for the route**

Test:
- POST without admin session → 403
- POST with admin session → calls `syncPrintfulCatalog`, returns 200 with result

- [ ] **Step 9.5: Implement route**

Create `app/api/shop/sync/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { syncPrintfulCatalog } from "@/lib/shop/sync"
import { findPendingOrdersOlderThan, updateOrderStatus } from "@/lib/db/shop-orders"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const result = await syncPrintfulCatalog()

    const stale = await findPendingOrdersOlderThan(25)
    let canceled = 0
    for (const order of stale) {
      try { await updateOrderStatus(order.id, "canceled"); canceled += 1 } catch { /* skip */ }
    }

    return NextResponse.json({ ...result, stale_orders_canceled: canceled })
  } catch (err) {
    console.error("[shop sync]", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 9.6: Run all tests, expect pass**

Run: `npm run test:run -- api/shop/sync shop/sync`

- [ ] **Step 9.7: Commit**

```bash
git add lib/shop/sync.ts app/api/shop/sync/route.ts __tests__
git commit -m "feat(shop): add Printful catalog sync service and admin endpoint"
```

---

## Task 10: Firebase Storage upload endpoint for admin image overrides

**Files:**
- Create: `app/api/uploads/shop/route.ts`
- Verify Firebase Admin SDK is installed (if not: `npm install firebase-admin`)

- [ ] **Step 10.1: Check/install Firebase Admin SDK**

Run: `npm ls firebase-admin`
If missing: `npm install firebase-admin`

- [ ] **Step 10.2: Implement upload route**

Create `app/api/uploads/shop/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { randomBytes } from "node:crypto"
import { getApps, initializeApp, cert } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"

function ensureFirebase() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    })
  }
}

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Unsupported type" }, { status: 415 })

  ensureFirebase()
  const bucket = getStorage().bucket()
  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp"
  const path = `shop/${randomBytes(16).toString("hex")}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const ref = bucket.file(path)
  await ref.save(buffer, { metadata: { contentType: file.type, cacheControl: "public, max-age=31536000" }, resumable: false })
  await ref.makePublic()
  const url = `https://storage.googleapis.com/${bucket.name}/${path}`
  return NextResponse.json({ url })
}
```

- [ ] **Step 10.3: Commit**

```bash
git add app/api/uploads/shop/route.ts package.json package-lock.json
git commit -m "feat(shop): add admin-only Firebase Storage upload for image overrides"
```

---

## Task 11: Admin shop sidebar entry

**Files:**
- Modify: admin sidebar component (find with `grep -l "admin" components/admin/Sidebar* || grep -ri 'href=\"/admin/' components/admin/`)

- [ ] **Step 11.1: Locate sidebar**

Run: `grep -ril "/admin/blog" components/`
Open the matching file. Identify the nav-item array pattern (usually `{ label, href, icon }`).

- [ ] **Step 11.2: Add Shop entry**

Add a group or item:
```tsx
{ label: "Shop", href: "/admin/shop/products", icon: ShoppingBag, subItems: [
  { label: "Products", href: "/admin/shop/products" },
  { label: "Orders", href: "/admin/shop/orders" },
]}
```

Import `ShoppingBag` from `lucide-react`. Match the existing sidebar data shape exactly — if it uses flat items without subItems, add two items instead.

- [ ] **Step 11.3: Verify in dev**

Run: `npm run dev`
Open `http://localhost:3050/admin`, log in as admin, confirm the Shop entry appears and links route to 404 pages (expected — pages don't exist yet).

- [ ] **Step 11.4: Commit**

```bash
git add components/admin
git commit -m "feat(shop): add Shop entries to admin sidebar"
```

---

## Task 12: Admin products list page

**Files:**
- Create: `app/(admin)/admin/shop/products/page.tsx`
- Create: `app/(admin)/admin/shop/products/ShopProductsTable.tsx`
- Create: `app/(admin)/admin/shop/products/SyncButton.tsx`

Follow [app/(admin)/admin/blog/page.tsx](../../../app/(admin)/admin/blog/page.tsx) for layout.

- [ ] **Step 12.1: Implement page (server component)**

```tsx
// app/(admin)/admin/shop/products/page.tsx
import { ShoppingBag, Star, CheckCircle2, RefreshCw } from "lucide-react"
import { listAllProducts } from "@/lib/db/shop-products"
import { ShopProductsTable } from "./ShopProductsTable"
import { SyncButton } from "./SyncButton"

export const metadata = { title: "Shop Products · Admin" }

export default async function ShopProductsPage() {
  const products = await listAllProducts()
  const total = products.length
  const active = products.filter((p) => p.is_active).length
  const featured = products.filter((p) => p.is_featured).length
  const lastSync = products.reduce<string | null>((acc, p) => (p.last_synced_at && (!acc || p.last_synced_at > acc) ? p.last_synced_at : acc), null)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading text-primary">Shop Products</h1>
          <p className="text-sm text-muted-foreground">Manage products synced from Printful</p>
        </div>
        <SyncButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard icon={ShoppingBag} label="Total" value={total} />
        <StatCard icon={CheckCircle2} label="Active" value={active} />
        <StatCard icon={Star} label="Featured" value={featured} />
        <StatCard icon={RefreshCw} label="Last Sync" value={lastSync ? new Date(lastSync).toLocaleDateString() : "Never"} />
      </div>

      <ShopProductsTable products={products} />
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
      <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-3.5 sm:size-4 text-primary" />
      </div>
      <div>
        <p className="text-[10px] sm:text-xs text-muted-foreground">{label}</p>
        <p className="text-lg sm:text-2xl font-semibold text-primary">{value}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 12.2: Implement `SyncButton.tsx` (client)**

```tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export function SyncButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  return (
    <Button
      onClick={async () => {
        setLoading(true)
        try {
          const res = await fetch("/api/shop/sync", { method: "POST" })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? "Sync failed")
          toast.success(`Sync complete: ${data.added} added, ${data.updated} updated, ${data.deactivated_variants} variants deactivated`)
          router.refresh()
        } catch (err) {
          toast.error((err as Error).message)
        } finally { setLoading(false) }
      }}
      disabled={loading}
    >
      <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Syncing…" : "Sync from Printful"}
    </Button>
  )
}
```

- [ ] **Step 12.3: Implement `ShopProductsTable.tsx` (client)**

Build a table with columns: thumbnail, name, variants count (fetch count via a lightweight server action or inline query in the server page), price range, active toggle, featured toggle, last synced, row actions (Edit link, View public).

For active/featured toggles: use `<Switch>` from `components/ui/switch`, on change POST to a new route `/api/admin/shop/products/[id]` with the toggled field. (Create that route now — it's a small PATCH wrapper around `updateProduct`.)

For brevity, the implementation follows the blog table pattern exactly. Use `@dnd-kit` with `sortOrder` for drag-to-reorder (same pattern used elsewhere — check for existing `@dnd-kit` usage with `grep -l "useSortable" components/`).

- [ ] **Step 12.4: Create PATCH route for admin product updates**

`app/api/admin/shop/products/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminUpdateProductSchema } from "@/lib/validators/shop"
import { updateProduct } from "@/lib/db/shop-products"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const body = await request.json()
  const parsed = adminUpdateProductSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const updated = await updateProduct(id, parsed.data)
  return NextResponse.json(updated)
}
```

- [ ] **Step 12.5: Manual verification**

Run dev server, seed at least one test product in Printful, click Sync, confirm products appear in list. Toggle active/featured, verify persistence.

- [ ] **Step 12.6: Commit**

```bash
git add app/(admin)/admin/shop/products app/api/admin/shop/products
git commit -m "feat(shop): add admin products list with sync, toggles, and stats"
```

---

## Task 13: Admin product detail/edit page

**Files:**
- Create: `app/(admin)/admin/shop/products/[id]/page.tsx`
- Create: `app/(admin)/admin/shop/products/[id]/ProductEditor.tsx`
- Create: `app/(admin)/admin/shop/products/[id]/VariantsPanel.tsx`
- Create: `app/(admin)/admin/shop/products/[id]/ImageUpload.tsx`

- [ ] **Step 13.1: Server page**

```tsx
import { notFound } from "next/navigation"
import { getProductById } from "@/lib/db/shop-products"
import { listAllVariantsForProduct } from "@/lib/db/shop-variants"
import { ProductEditor } from "./ProductEditor"
import { VariantsPanel } from "./VariantsPanel"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProductById(id)
  if (!product) notFound()
  const variants = await listAllVariantsForProduct(id)
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <h1 className="text-2xl font-heading text-primary">{product.name}</h1>
      <ProductEditor product={product} />
      <VariantsPanel variants={variants} />
    </div>
  )
}
```

- [ ] **Step 13.2: `ProductEditor.tsx` (client)**

Renders form with:
- Name (read-only)
- Slug (read-only, shown for reference)
- Description — TipTap editor (reuse the exact setup from `components/forms/` or blog editor — `grep -l "useEditor" components/`)
- Thumbnail — current `thumbnail_url_override ?? thumbnail_url`, `ImageUpload` component for override, "Clear override" button
- Active, Featured switches
- Save button — PATCH `/api/admin/shop/products/[id]` with `{ description, thumbnail_url_override, is_active, is_featured }`

- [ ] **Step 13.3: `ImageUpload.tsx` (client)**

```tsx
"use client"
import { useState } from "react"
import { toast } from "sonner"

export function ImageUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  return (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      disabled={uploading}
      onChange={async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        setUploading(true)
        try {
          const fd = new FormData(); fd.append("file", file)
          const res = await fetch("/api/uploads/shop", { method: "POST", body: fd })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? "Upload failed")
          onUploaded(data.url); toast.success("Image uploaded")
        } catch (err) { toast.error((err as Error).message) }
        finally { setUploading(false); e.target.value = "" }
      }}
    />
  )
}
```

- [ ] **Step 13.4: `VariantsPanel.tsx` (client)**

Read-only table: SKU, variant name, size, color, Printful cost, retail price, available. Per-row: small "Upload override image" button (uses `ImageUpload`, saves to `/api/admin/shop/variants/[id]` PATCH route).

- [ ] **Step 13.5: Create variant PATCH route**

`app/api/admin/shop/variants/[id]/route.ts`: same shape as the product PATCH route using `adminUpdateVariantSchema` and `updateVariant` from `lib/db/shop-variants`.

- [ ] **Step 13.6: Manual verification**

Load a product detail page, edit description, upload a thumbnail override, toggle active. Reload to confirm persistence.

- [ ] **Step 13.7: Commit**

```bash
git add app/(admin)/admin/shop/products/[id] app/api/admin/shop/variants
git commit -m "feat(shop): add admin product detail editor with image overrides"
```

---

## Task 14: Admin orders list page

**Files:**
- Create: `app/(admin)/admin/shop/orders/page.tsx`
- Create: `app/(admin)/admin/shop/orders/ShopOrdersTable.tsx`

- [ ] **Step 14.1: Server page**

Pattern matches Task 12. Fetch `getOrderStats()` and `listOrders()` (no filter for default "All" tab). Render 5 stat cards (today, needs action, in production, shipped this week, revenue). Pass orders to `ShopOrdersTable`.

- [ ] **Step 14.2: `ShopOrdersTable.tsx` (client)**

Tabs: All / Needs Action / In Production / Shipped / Issues. Each tab filters the `orders` prop by status (client-side filtering since the server fetches everything). If performance becomes an issue (>500 orders), move filtering to a server-side API that accepts `?status=`.

Columns: order number (Link to detail), customer name + email, items summary (first item + "+N more"), total (formatted cents to dollars), status badge (color-coded via `data-status` attribute), age ("2h ago" via `formatDistanceToNow` from `date-fns`).

- [ ] **Step 14.3: Commit**

```bash
git add app/(admin)/admin/shop/orders
git commit -m "feat(shop): add admin orders list with status tabs and stats"
```

---

## Task 15: Admin order detail page + actions

**Files:**
- Create: `app/(admin)/admin/shop/orders/[id]/page.tsx`
- Create: `app/(admin)/admin/shop/orders/[id]/OrderActions.tsx`
- Create: `app/(admin)/admin/shop/orders/[id]/Timeline.tsx`
- Create: `app/api/admin/shop/orders/[id]/confirm/route.ts`
- Create: `app/api/admin/shop/orders/[id]/cancel/route.ts`
- Create: `app/api/admin/shop/orders/[id]/refund/route.ts`
- Create: `app/api/admin/shop/orders/[id]/notes/route.ts`
- Create: `lib/shop/fulfillment.ts` — pure functions for confirm/cancel/refund

Separating `lib/shop/fulfillment.ts` keeps the routes thin and lets us unit-test the lifecycle transitions.

- [ ] **Step 15.1: Implement `lib/shop/fulfillment.ts`**

```typescript
import { stripe } from "@/lib/stripe"
import { createOrder as createPrintfulOrder, confirmOrder as confirmPrintfulOrder, cancelOrder as cancelPrintfulOrder, type PrintfulRecipient } from "@/lib/printful"
import { getOrderById, updateOrder, updateOrderStatus } from "@/lib/db/shop-orders"
import { getVariantById } from "@/lib/db/shop-variants"
import type { ShopOrder } from "@/types/database"

function addressToRecipient(order: ShopOrder): PrintfulRecipient {
  const a = order.shipping_address
  return {
    name: a.name, email: a.email, phone: a.phone,
    address1: a.line1, address2: a.line2,
    city: a.city, state_code: a.state,
    country_code: a.country, zip: a.postal_code,
  }
}

export async function confirmOrderToPrintful(orderId: string): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (order.status !== "paid") throw new Error(`Cannot confirm order in status ${order.status}`)

  const items = order.items.map((i) => ({
    sync_variant_id: undefined as number | undefined,
    variant_id: i.printful_variant_id,
    quantity: i.quantity,
    retail_price: (i.unit_price_cents / 100).toFixed(2),
  }))

  const draft = await createPrintfulOrder({
    external_id: order.order_number,
    recipient: addressToRecipient(order),
    items,
  })

  await updateOrder(order.id, {
    status: "draft",
    printful_order_id: draft.id,
  })

  await confirmPrintfulOrder(draft.id)
  return updateOrderStatus(order.id, "confirmed")
}

export async function cancelShopOrder(orderId: string): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (order.status !== "paid" && order.status !== "draft") {
    throw new Error(`Cannot cancel order in status ${order.status}`)
  }

  if (order.printful_order_id) {
    try { await cancelPrintfulOrder(order.printful_order_id) } catch (err) { console.error("[cancel] Printful cancel failed", err) }
  }
  if (order.stripe_payment_intent_id) {
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })
  }
  return updateOrderStatus(order.id, "canceled", { refund_amount_cents: order.total_cents })
}

export async function refundShopOrder(orderId: string, amountCents: number, reason?: string): Promise<ShopOrder> {
  const order = await getOrderById(orderId)
  if (!order) throw new Error("Order not found")
  if (!order.stripe_payment_intent_id) throw new Error("No Stripe payment intent")
  if (amountCents > order.total_cents) throw new Error("Refund exceeds total")

  await stripe.refunds.create({
    payment_intent: order.stripe_payment_intent_id,
    amount: amountCents,
    reason: reason ? "requested_by_customer" : undefined,
  })

  const isFull = amountCents >= order.total_cents
  const notes = reason ? `${order.notes ?? ""}\n[refund] ${reason}`.trim() : order.notes
  if (isFull) return updateOrderStatus(order.id, "refunded", { refund_amount_cents: amountCents, notes })
  return updateOrder(order.id, { refund_amount_cents: (order.refund_amount_cents ?? 0) + amountCents, notes })
}
```

- [ ] **Step 15.2: Write tests for fulfillment**

Mock `lib/stripe`, `lib/printful`, DAL modules. Cover:
- `confirmOrderToPrintful` throws when status ≠ paid
- Creates draft, stores `printful_order_id`, confirms, status → confirmed
- `cancelShopOrder` refunds Stripe in full, cancels Printful draft if present, status → canceled
- `refundShopOrder` full vs partial behavior (status transition only on full)

- [ ] **Step 15.3: Implement action API routes**

`app/api/admin/shop/orders/[id]/confirm/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { confirmOrderToPrintful } from "@/lib/shop/fulfillment"
import { sendOrderConfirmedEmail } from "@/lib/shop/emails"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  try {
    const order = await confirmOrderToPrintful(id)
    await sendOrderConfirmedEmail(order)
    return NextResponse.json(order)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
```

Analogous for `/cancel` and `/refund` (refund takes `{ amount_cents, reason? }` body validated by `adminRefundSchema`).

`/notes/route.ts` — PATCH takes `{ notes: string }` and calls `updateOrder(id, { notes })`.

- [ ] **Step 15.4: Implement detail page UI**

Page renders:
- Customer block, items block, totals block, timeline (derived from status + timestamps), tracking block (when tracking fields populated).
- `<OrderActions>` client component with buttons gated by status:
  - status `paid` → "Confirm to Printful" (POST `/confirm`) + "Cancel"
  - status `draft` → "Cancel"
  - status ∈ {`confirmed`, `in_production`, `shipped`} → "Refund" (opens modal, full or partial)
- Admin notes textarea — `onBlur` PATCHes `/notes`.

- [ ] **Step 15.5: Manual verification**

Create a test paid order (via test Stripe checkout if infra allows, or insert directly via SQL for now). Click Confirm, verify Printful draft shows up in Printful dashboard (use sandbox credentials).

- [ ] **Step 15.6: Commit**

```bash
git add lib/shop/fulfillment.ts app/api/admin/shop/orders app/(admin)/admin/shop/orders/[id]
git commit -m "feat(shop): add admin order detail with confirm/cancel/refund actions"
```

---

## Task 16: Cart client hook

**Files:**
- Create: `lib/shop/cart.ts`
- Create: `__tests__/lib/shop/cart.test.ts`

- [ ] **Step 16.1: Write failing tests**

Test that the hook:
- Starts empty when `localStorage` has no key
- Restores from `localStorage` on mount
- `addItem` increments quantity if same `variant_id`
- `removeItem`, `updateQuantity`, `clear` behave correctly
- Persists to `localStorage` after every mutation
- `totalItems` sum and `hasItems` flag

Use `renderHook` from `@testing-library/react`.

- [ ] **Step 16.2: Implement hook**

```typescript
"use client"
import { useCallback, useEffect, useState } from "react"

const KEY = "djp_shop_cart"

export interface CartLine {
  variant_id: string
  quantity: number
}

function read(): CartLine[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is CartLine =>
      typeof x?.variant_id === "string" && typeof x?.quantity === "number" && x.quantity > 0
    )
  } catch { return [] }
}

function write(lines: CartLine[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(lines))
  window.dispatchEvent(new Event("djp-cart-change"))
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([])

  useEffect(() => {
    setLines(read())
    const onChange = () => setLines(read())
    window.addEventListener("djp-cart-change", onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener("djp-cart-change", onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [])

  const addItem = useCallback((variant_id: string, quantity = 1) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variant_id === variant_id)
      const next = idx >= 0
        ? prev.map((l, i) => i === idx ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l)
        : [...prev, { variant_id, quantity: Math.min(99, quantity) }]
      write(next)
      return next
    })
  }, [])

  const removeItem = useCallback((variant_id: string) => {
    setLines((prev) => { const next = prev.filter((l) => l.variant_id !== variant_id); write(next); return next })
  }, [])

  const updateQuantity = useCallback((variant_id: string, quantity: number) => {
    setLines((prev) => {
      const next = quantity <= 0
        ? prev.filter((l) => l.variant_id !== variant_id)
        : prev.map((l) => l.variant_id === variant_id ? { ...l, quantity: Math.min(99, quantity) } : l)
      write(next); return next
    })
  }, [])

  const clear = useCallback(() => { write([]); setLines([]) }, [])

  const totalItems = lines.reduce((sum, l) => sum + l.quantity, 0)
  return { lines, totalItems, hasItems: lines.length > 0, addItem, removeItem, updateQuantity, clear }
}
```

- [ ] **Step 16.3: Run tests, expect pass**

- [ ] **Step 16.4: Commit**

```bash
git add lib/shop/cart.ts __tests__/lib/shop/cart.test.ts
git commit -m "feat(shop): add cart hook with localStorage persistence"
```

---

## Task 17: Public shop grid with "Coming Soon" gate

**Files:**
- Modify: `app/(marketing)/shop/page.tsx` (replace iframe)
- Create: `components/public/shop/ProductCard.tsx`
- Create: `components/public/shop/ComingSoon.tsx`
- Delete: `components/public/ShopEmbed.tsx` (if it exists — verify with `ls components/public/`)

- [ ] **Step 17.1: Implement `ComingSoon.tsx`**

Simple hero card: heading "Coming Soon", sub "Official DJP Athlete gear is almost ready," CTA button linking to newsletter signup or homepage. Match existing marketing aesthetic.

- [ ] **Step 17.2: Implement `ProductCard.tsx`**

```tsx
import Link from "next/link"
import Image from "next/image"
import type { ShopProduct } from "@/types/database"

export function ProductCard({ product, priceRange }: { product: ShopProduct; priceRange: { min: number } }) {
  const src = product.thumbnail_url_override ?? product.thumbnail_url
  return (
    <Link href={`/shop/${product.slug}`} className="group block">
      <div className="aspect-square bg-surface rounded-xl overflow-hidden relative">
        {src ? <Image src={src} alt={product.name} fill className="object-cover group-hover:scale-105 transition" /> : null}
      </div>
      <h3 className="mt-3 font-heading text-primary">{product.name}</h3>
      <p className="text-sm text-muted-foreground">From ${(priceRange.min / 100).toFixed(2)}</p>
    </Link>
  )
}
```

- [ ] **Step 17.3: Rewrite `app/(marketing)/shop/page.tsx`**

```tsx
import { listActiveProducts } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { ProductCard } from "@/components/public/shop/ProductCard"
import { ComingSoon } from "@/components/public/shop/ComingSoon"

export const metadata = { title: "Shop · DJP Athlete" }

export default async function ShopPage() {
  if (!isShopEnabled()) return <ComingSoon />
  const products = await listActiveProducts()
  const withPrices = await Promise.all(products.map(async (p) => {
    const variants = await listVariantsForProduct(p.id)
    const min = variants.length > 0 ? Math.min(...variants.map((v) => v.retail_price_cents)) : 0
    return { product: p, priceRange: { min } }
  }))
  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="font-heading text-4xl text-primary mb-8">Shop</h1>
      {withPrices.length === 0 ? (
        <p className="text-muted-foreground">No products yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {withPrices.map(({ product, priceRange }) => (
            <ProductCard key={product.id} product={product} priceRange={priceRange} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 17.4: Remove or archive old iframe component**

Check if `components/public/ShopEmbed.tsx` is imported anywhere with `grep -r "ShopEmbed" .`. If only in the old `shop/page.tsx`, delete the file. Otherwise leave it.

- [ ] **Step 17.5: Commit**

```bash
git add app/(marketing)/shop/page.tsx components/public/shop
git rm components/public/ShopEmbed.tsx  # only if safe to remove
git commit -m "feat(shop): replace iframe shop with custom grid (feature-gated)"
```

---

## Task 18: Public product detail page

**Files:**
- Create: `app/(marketing)/shop/[slug]/page.tsx`
- Create: `components/public/shop/VariantPicker.tsx`
- Create: `components/public/shop/AddToCartButton.tsx`

- [ ] **Step 18.1: Server page with feature flag guard**

```tsx
import { notFound } from "next/navigation"
import { getProductBySlug } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"
import { isShopEnabled } from "@/lib/shop/feature-flag"
import { VariantPicker } from "@/components/public/shop/VariantPicker"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: "Not found" }
  return { title: `${product.name} · DJP Athlete Shop`, description: product.description?.slice(0, 150) }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  if (!isShopEnabled()) notFound()
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product || !product.is_active) notFound()
  const variants = await listVariantsForProduct(product.id)
  if (variants.length === 0) notFound()
  return <VariantPicker product={product} variants={variants} />
}
```

- [ ] **Step 18.2: `VariantPicker.tsx`**

Client component. State: selected size + color. Derived: matching variant (unique by size+color). On "Add to Cart" click, use `useCart().addItem(variant.id)`. Show sticky image carousel (or just `mockup_url_override ?? mockup_url` of selected variant). Price updates when variant changes. Description rendered as dangerous HTML (TipTap output is sanitized).

- [ ] **Step 18.3: Commit**

```bash
git add app/(marketing)/shop/[slug] components/public/shop
git commit -m "feat(shop): add public product detail with variant picker"
```

---

## Task 19: Cart page

**Files:**
- Create: `app/(marketing)/shop/cart/page.tsx`
- Create: `app/api/shop/cart-items/route.ts` — hydrate cart lines with variant data
- Create: `components/public/shop/CartSummary.tsx`

- [ ] **Step 19.1: Implement `/api/shop/cart-items`**

```typescript
import { NextResponse } from "next/server"
import { z } from "zod"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getProductById } from "@/lib/db/shop-products"

const schema = z.object({ variant_ids: z.array(z.string()).max(50) })

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const variants = await getVariantsByIds(parsed.data.variant_ids)
  const productIds = [...new Set(variants.map((v) => v.product_id))]
  const products = await Promise.all(productIds.map(getProductById))
  const productMap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]))
  return NextResponse.json({
    items: variants.map((v) => {
      const p = productMap.get(v.product_id)
      return {
        variant_id: v.id,
        product_id: v.product_id,
        product_slug: p?.slug ?? "",
        product_name: p?.name ?? "",
        variant_name: v.name,
        thumbnail_url: v.mockup_url_override ?? v.mockup_url ?? p?.thumbnail_url_override ?? p?.thumbnail_url ?? "",
        unit_price_cents: v.retail_price_cents,
        is_available: v.is_available && (p?.is_active ?? false),
        printful_variant_id: v.printful_variant_id,
      }
    }),
  })
}
```

- [ ] **Step 19.2: `/shop/cart/page.tsx`** (client component because it reads localStorage)

On mount: read `useCart().lines`, POST `/api/shop/cart-items`, merge quantities. Render item list with qty stepper (uses `updateQuantity`), remove button, subtotal. If any item has `is_available=false`, show red "No longer available — remove to continue" banner. Disable "Checkout" button until all items are available. Button routes to `/shop/checkout`.

- [ ] **Step 19.3: Commit**

```bash
git add app/(marketing)/shop/cart app/api/shop/cart-items components/public/shop
git commit -m "feat(shop): add cart page with availability validation"
```

---

## Task 20: Shipping quote API

**Files:**
- Create: `app/api/shop/quote/route.ts`
- Create: `__tests__/api/shop/quote.test.ts`

- [ ] **Step 20.1: Write failing tests**

Cover: invalid body → 400; item with unavailable variant → 409; Printful error → 502; happy path → returns cheapest rate + line items with unit_price_cents + subtotal.

- [ ] **Step 20.2: Implement route**

```typescript
import { NextResponse } from "next/server"
import { shippingQuoteRequestSchema } from "@/lib/validators/shop"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getShippingRates, PrintfulError } from "@/lib/printful"

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = shippingQuoteRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { items, address } = parsed.data

  const variantIds = items.map((i) => i.variant_id)
  const variants = await getVariantsByIds(variantIds)
  const variantMap = new Map(variants.map((v) => [v.id, v]))

  const lines = items.map((i) => {
    const v = variantMap.get(i.variant_id)
    if (!v || !v.is_available) return null
    return { variant_id: v.id, quantity: i.quantity, printful_variant_id: v.printful_variant_id, unit_price_cents: v.retail_price_cents }
  })
  if (lines.some((l) => l === null)) return NextResponse.json({ error: "One or more items unavailable" }, { status: 409 })
  const valid = lines as NonNullable<(typeof lines)[number]>[]

  try {
    const rates = await getShippingRates({
      recipient: {
        name: address.name, email: address.email, phone: address.phone,
        address1: address.line1, address2: address.line2,
        city: address.city, state_code: address.state,
        country_code: address.country, zip: address.postal_code,
      },
      items: valid.map((l) => ({ variant_id: l.printful_variant_id, quantity: l.quantity })),
    })
    if (rates.length === 0) return NextResponse.json({ error: "No shipping options available for this address" }, { status: 422 })
    const cheapest = rates.reduce((a, b) => parseFloat(a.rate) <= parseFloat(b.rate) ? a : b)
    const shipping_cents = Math.round(parseFloat(cheapest.rate) * 100)
    const subtotal_cents = valid.reduce((s, l) => s + l.unit_price_cents * l.quantity, 0)
    return NextResponse.json({
      shipping_cents,
      shipping_label: cheapest.name,
      subtotal_cents,
      total_cents: subtotal_cents + shipping_cents,
    })
  } catch (err) {
    if (err instanceof PrintfulError) return NextResponse.json({ error: err.message }, { status: 502 })
    throw err
  }
}
```

- [ ] **Step 20.3: Run tests, expect pass**

- [ ] **Step 20.4: Commit**

```bash
git add app/api/shop/quote __tests__/api/shop/quote.test.ts
git commit -m "feat(shop): add Printful shipping quote endpoint"
```

---

## Task 21: Checkout API

**Files:**
- Create: `app/api/shop/checkout/route.ts`
- Create: `__tests__/api/shop/checkout.test.ts`

- [ ] **Step 21.1: Write failing tests**

Cover: body validation; re-validates variant availability (409 if changed); creates draft order with `status='pending'`; creates Stripe session with ad-hoc line items + shipping option + metadata `{ type: 'shop_order', order_id, order_number }`; returns `{ url, order_number }`.

- [ ] **Step 21.2: Implement route**

```typescript
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { checkoutRequestSchema } from "@/lib/validators/shop"
import { getVariantsByIds } from "@/lib/db/shop-variants"
import { getProductById } from "@/lib/db/shop-products"
import { createOrder, updateOrder } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"
import type { ShopOrderItem } from "@/types/database"

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = checkoutRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { items, address, shipping_cents } = parsed.data

  const session = await auth()
  const userId = session?.user?.id ?? null

  const variants = await getVariantsByIds(items.map((i) => i.variant_id))
  const variantMap = new Map(variants.map((v) => [v.id, v]))
  const products = await Promise.all([...new Set(variants.map((v) => v.product_id))].map(getProductById))
  const productMap = new Map(products.filter(Boolean).map((p) => [p!.id, p!]))

  const orderItems: ShopOrderItem[] = []
  for (const line of items) {
    const v = variantMap.get(line.variant_id)
    const p = v ? productMap.get(v.product_id) : undefined
    if (!v || !v.is_available || !p || !p.is_active) {
      return NextResponse.json({ error: "One or more items unavailable" }, { status: 409 })
    }
    orderItems.push({
      variant_id: v.id,
      product_id: v.product_id,
      name: p.name,
      variant_name: v.name,
      thumbnail_url: v.mockup_url_override ?? v.mockup_url ?? p.thumbnail_url_override ?? p.thumbnail_url,
      quantity: line.quantity,
      unit_price_cents: v.retail_price_cents,
      printful_variant_id: v.printful_variant_id,
    })
  }

  const subtotal_cents = orderItems.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0)
  const total_cents = subtotal_cents + shipping_cents

  const order = await createOrder({
    user_id: userId,
    customer_email: address.email,
    customer_name: address.name,
    shipping_address: address,
    status: "pending",
    items: orderItems,
    subtotal_cents,
    shipping_cents,
    total_cents,
    tracking_number: null,
    tracking_url: null,
    carrier: null,
    refund_amount_cents: null,
    notes: null,
  } as any)

  const origin = new URL(request.url).origin
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: address.email,
    line_items: [
      ...orderItems.map((i) => ({
        price_data: {
          currency: "usd",
          product_data: { name: `${i.name} — ${i.variant_name}` },
          unit_amount: i.unit_price_cents,
        },
        quantity: i.quantity,
      })),
      ...(shipping_cents > 0 ? [{
        price_data: {
          currency: "usd",
          product_data: { name: "Shipping" },
          unit_amount: shipping_cents,
        },
        quantity: 1,
      }] : []),
    ],
    metadata: { type: "shop_order", order_id: order.id, order_number: order.order_number },
    success_url: `${origin}/shop/orders/${order.order_number}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/shop/cart`,
  })

  await updateOrder(order.id, { stripe_session_id: stripeSession.id })
  return NextResponse.json({ url: stripeSession.url, order_number: order.order_number })
}
```

- [ ] **Step 21.3: Run tests, expect pass**

- [ ] **Step 21.4: Commit**

```bash
git add app/api/shop/checkout __tests__/api/shop/checkout.test.ts
git commit -m "feat(shop): add checkout API creating draft order + Stripe session"
```

---

## Task 22: Checkout page UI

**Files:**
- Create: `app/(marketing)/shop/checkout/page.tsx`
- Create: `components/public/shop/AddressForm.tsx`
- Create: `components/public/shop/QuoteSummary.tsx`

- [ ] **Step 22.1: Implement page (client, feature-gated)**

Steps:
1. Load cart via `useCart`; if empty, redirect to `/shop/cart`.
2. Show `AddressForm` — on submit, POST `/api/shop/quote` with `{ items, address }`. Show spinner, then `QuoteSummary` with editable address (allow going back).
3. In summary: "Pay with Stripe" button → POST `/api/shop/checkout` with `{ items, address, shipping_cents }` → redirect to returned `url`.

Pre-fill address from session user if logged in (fetch `/api/me` or read from NextAuth client session — check existing pattern). Validate address with `shippingAddressSchema` in-form via `react-hook-form` + `zodResolver`.

- [ ] **Step 22.2: Commit**

```bash
git add app/(marketing)/shop/checkout components/public/shop
git commit -m "feat(shop): add customer checkout page with address form + quote review"
```

---

## Task 23: Stripe webhook extension

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Create: `lib/shop/webhooks.ts` — handler function

- [ ] **Step 23.1: Implement `lib/shop/webhooks.ts`**

```typescript
import Stripe from "stripe"
import { getOrderByStripeSessionId, updateOrder, updateOrderStatus } from "@/lib/db/shop-orders"
import { sendOrderReceivedEmail } from "@/lib/shop/emails"

export async function handleShopOrderCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (!session.id) return
  const order = await getOrderByStripeSessionId(session.id)
  if (!order) { console.error("[shop webhook] order not found for session", session.id); return }
  if (order.status !== "pending") return  // idempotent replay guard

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null

  const updated = await updateOrderStatus(order.id, "paid", { stripe_payment_intent_id: paymentIntentId ?? undefined })
  await sendOrderReceivedEmail(updated)
}
```

- [ ] **Step 23.2: Extend `app/api/stripe/webhook/route.ts`**

In the existing `switch (event.type) { case "checkout.session.completed": { ... } }` branch, insert early:

```typescript
if (session.metadata?.type === "shop_order") {
  await handleShopOrderCheckout(session); break
}
```

(Place above the `event_signup` / `week_access` checks so we short-circuit.)

Add import: `import { handleShopOrderCheckout } from "@/lib/shop/webhooks"`.

- [ ] **Step 23.3: Add tests**

Test `handleShopOrderCheckout`:
- No matching order → logs error, no throw
- Order status already `paid` → no-op (idempotency)
- Happy path: status pending → paid, stores `stripe_payment_intent_id`, calls email sender (mocked)

- [ ] **Step 23.4: Commit**

```bash
git add lib/shop/webhooks.ts app/api/stripe/webhook/route.ts __tests__
git commit -m "feat(shop): handle shop_order in Stripe checkout.session.completed webhook"
```

---

## Task 24: Email templates and sender

**Files:**
- Create: `lib/shop/emails.ts`
- Create: `lib/shop/emails/order-received.tsx`
- Create: `lib/shop/emails/order-confirmed.tsx`
- Create: `lib/shop/emails/order-shipped.tsx`
- Create: `lib/shop/emails/order-canceled.tsx`
- Create: `lib/shop/emails/order-refunded.tsx`

- [ ] **Step 24.1: Check Resend helper**

Run: `grep -l "resend" lib/ -ri` to find the existing Resend client wrapper. If one exists (likely `lib/resend.ts` or similar), use it. Otherwise create `lib/resend.ts` mirroring the pattern of `lib/stripe.ts`:

```typescript
import { Resend } from "resend"
export const resend = new Resend(process.env.RESEND_API_KEY!)
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "no-reply@djpathlete.com"
```

- [ ] **Step 24.2: Implement templates**

Each template is a React component receiving a `ShopOrder` and returning JSX. Use React Email components if `@react-email/components` is installed (check `package.json`); otherwise plain JSX rendered to HTML via `renderToStaticMarkup`. Use brand colors from CSS vars.

`order-received.tsx` example:

```tsx
import type { ShopOrder } from "@/types/database"

export function OrderReceivedEmail({ order, lookupUrl }: { order: ShopOrder; lookupUrl: string }) {
  return (
    <html>
      <body style={{ fontFamily: "sans-serif", background: "#f6f6f4", padding: 24 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", background: "white", padding: 24, borderRadius: 12 }}>
          <h1 style={{ color: "#0E3F50" }}>Order received</h1>
          <p>Hi {order.customer_name}, thanks for your order!</p>
          <p>Order number: <strong>{order.order_number}</strong></p>
          <ul>
            {order.items.map((i) => (
              <li key={i.variant_id}>{i.quantity} × {i.name} — {i.variant_name}</li>
            ))}
          </ul>
          <p>Total: ${(order.total_cents / 100).toFixed(2)}</p>
          <p>Track your order: <a href={lookupUrl}>{lookupUrl}</a></p>
        </div>
      </body>
    </html>
  )
}
```

Repeat for the other four templates with appropriate copy.

- [ ] **Step 24.3: Implement `lib/shop/emails.ts`**

```typescript
import { renderToStaticMarkup } from "react-dom/server"
import { resend, FROM_EMAIL } from "@/lib/resend"
import type { ShopOrder } from "@/types/database"
import { OrderReceivedEmail } from "./emails/order-received"
import { OrderConfirmedEmail } from "./emails/order-confirmed"
import { OrderShippedEmail } from "./emails/order-shipped"
import { OrderCanceledEmail } from "./emails/order-canceled"
import { OrderRefundedEmail } from "./emails/order-refunded"

function lookupUrl(order: ShopOrder): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3050"
  return `${base}/shop/orders/${order.order_number}`
}

async function send(subject: string, html: string, to: string) {
  if (!process.env.RESEND_API_KEY) { console.warn("[shop email] RESEND_API_KEY missing, skipping"); return }
  await resend.emails.send({ from: FROM_EMAIL, to, subject, html })
}

export async function sendOrderReceivedEmail(order: ShopOrder) {
  const html = renderToStaticMarkup(<OrderReceivedEmail order={order} lookupUrl={lookupUrl(order)} />)
  await send(`Order received · ${order.order_number}`, html, order.customer_email)
}
export async function sendOrderConfirmedEmail(order: ShopOrder) {
  const html = renderToStaticMarkup(<OrderConfirmedEmail order={order} lookupUrl={lookupUrl(order)} />)
  await send(`Order confirmed · ${order.order_number}`, html, order.customer_email)
}
export async function sendOrderShippedEmail(order: ShopOrder) {
  const html = renderToStaticMarkup(<OrderShippedEmail order={order} lookupUrl={lookupUrl(order)} />)
  await send(`Your order has shipped · ${order.order_number}`, html, order.customer_email)
}
export async function sendOrderCanceledEmail(order: ShopOrder) {
  const html = renderToStaticMarkup(<OrderCanceledEmail order={order} lookupUrl={lookupUrl(order)} />)
  await send(`Order canceled · ${order.order_number}`, html, order.customer_email)
}
export async function sendOrderRefundedEmail(order: ShopOrder) {
  const html = renderToStaticMarkup(<OrderRefundedEmail order={order} lookupUrl={lookupUrl(order)} />)
  await send(`Refund processed · ${order.order_number}`, html, order.customer_email)
}
```

- [ ] **Step 24.4: Wire sends into fulfillment**

Extend `lib/shop/fulfillment.ts`:
- `cancelShopOrder` — after status update, `await sendOrderCanceledEmail(updated)`
- `refundShopOrder` — after status update, `await sendOrderRefundedEmail(updated)`

Update tests to verify the email sends were called.

- [ ] **Step 24.5: Commit**

```bash
git add lib/shop/emails lib/shop/emails.ts lib/shop/fulfillment.ts
git commit -m "feat(shop): add transactional emails for order lifecycle"
```

---

## Task 25: Printful webhook handler

**Files:**
- Create: `app/api/shop/webhooks/printful/route.ts`
- Create: `__tests__/api/shop/webhooks/printful.test.ts`
- Create: `lib/db/shop-orders.ts` — add `getOrderByPrintfulOrderId` (append to existing file)

- [ ] **Step 25.1: Append to `lib/db/shop-orders.ts`**

```typescript
export async function getOrderByPrintfulOrderId(printfulOrderId: number): Promise<ShopOrder | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("shop_orders").select("*").eq("printful_order_id", printfulOrderId).single()
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}
```

- [ ] **Step 25.2: Write failing tests**

Cover: bad signature → 401; unknown event type → 200 no-op; `package_shipped` → status `shipped`, stores tracking, sends email; `order_updated` with `fulfilled` → status stays if already ahead; idempotency (replay same event → no double email).

- [ ] **Step 25.3: Implement route**

```typescript
import { NextResponse } from "next/server"
import { verifyWebhookSignature } from "@/lib/printful"
import { getOrderByPrintfulOrderId, updateOrderStatus, updateOrder } from "@/lib/db/shop-orders"
import { sendOrderShippedEmail } from "@/lib/shop/emails"

interface PrintfulWebhookEvent {
  type: string
  created: number
  retries: number
  store: number
  data: {
    order?: { id: number; external_id: string; status: string; shipping: string }
    shipment?: { carrier: string; service: string; tracking_number: string; tracking_url: string; shipped_at: number }
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get("x-pf-webhook-signature")
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }
  const event = JSON.parse(rawBody) as PrintfulWebhookEvent
  const printfulOrderId = event.data.order?.id
  if (!printfulOrderId) return NextResponse.json({ ok: true })

  const order = await getOrderByPrintfulOrderId(printfulOrderId)
  if (!order) return NextResponse.json({ ok: true })

  switch (event.type) {
    case "package_shipped": {
      if (order.status === "shipped" || order.status === "refunded" || order.status === "canceled") break
      const s = event.data.shipment!
      const updated = await updateOrderStatus(order.id, "shipped", {
        tracking_number: s.tracking_number,
        tracking_url: s.tracking_url,
        carrier: s.carrier,
        shipped_at: new Date(s.shipped_at * 1000).toISOString(),
      })
      await sendOrderShippedEmail(updated)
      break
    }
    case "order_updated": {
      const status = event.data.order?.status
      if (status === "inprocess" && (order.status === "confirmed" || order.status === "paid")) {
        await updateOrderStatus(order.id, "in_production")
      }
      break
    }
    case "order_failed": {
      await updateOrder(order.id, { notes: `${order.notes ?? ""}\n[printful] order_failed event at ${new Date().toISOString()}`.trim() })
      break
    }
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 25.4: Run tests, expect pass**

- [ ] **Step 25.5: Commit**

```bash
git add app/api/shop/webhooks lib/db/shop-orders.ts __tests__
git commit -m "feat(shop): add Printful webhook handler for shipping + status updates"
```

---

## Task 26: Thank-you page

**Files:**
- Create: `app/(marketing)/shop/orders/[orderNumber]/thank-you/page.tsx`

- [ ] **Step 26.1: Implement**

```tsx
import { notFound } from "next/navigation"
import Link from "next/link"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { stripe } from "@/lib/stripe"

export default async function Page({ params, searchParams }: { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const { orderNumber } = await params
  const { session_id } = await searchParams
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()

  if (session_id) {
    const s = await stripe.checkout.sessions.retrieve(session_id)
    if (s.metadata?.order_number !== orderNumber) notFound()
  }

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <h1 className="font-heading text-4xl text-primary">Thank you for your order!</h1>
      <p className="text-muted-foreground mt-2">We've emailed a receipt to {order.customer_email}.</p>
      <div className="mt-8 p-6 bg-white rounded-xl border">
        <p>Order number: <strong>{order.order_number}</strong></p>
        <ul className="mt-4 space-y-2">
          {order.items.map((i) => (
            <li key={i.variant_id} className="flex justify-between">
              <span>{i.quantity} × {i.name} — {i.variant_name}</span>
              <span>${((i.unit_price_cents * i.quantity) / 100).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-4 border-t flex justify-between font-semibold">
          <span>Total</span>
          <span>${(order.total_cents / 100).toFixed(2)}</span>
        </div>
      </div>
      <p className="mt-8">
        <Link className="underline text-primary" href={`/shop/orders/${order.order_number}`}>View order status</Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 26.2: Clear cart client-side**

Add a small client component `<ClearCartOnMount />` to the page that calls `useCart().clear()` on mount. Place it inside the page JSX.

- [ ] **Step 26.3: Commit**

```bash
git add app/(marketing)/shop/orders
git commit -m "feat(shop): add thank-you page with order summary and cart clear"
```

---

## Task 27: Public order lookup page + API

**Files:**
- Create: `app/(marketing)/shop/orders/[orderNumber]/page.tsx`
- Create: `app/api/shop/orders/[orderNumber]/lookup/route.ts`
- Create: `lib/shop/rate-limit.ts` — simple in-memory rate limiter

- [ ] **Step 27.1: Implement rate limiter**

```typescript
const attempts = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; remaining: number } {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: max - 1 }
  }
  entry.count += 1
  if (entry.count > max) return { ok: false, remaining: 0 }
  return { ok: true, remaining: max - entry.count }
}
```

(In-memory is fine for v1 at expected volume. If the app runs multi-instance on Vercel, replace with Upstash/Redis later.)

- [ ] **Step 27.2: Implement lookup API**

```typescript
import { NextResponse } from "next/server"
import { orderLookupSchema } from "@/lib/validators/shop"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { rateLimit } from "@/lib/shop/rate-limit"

export async function POST(request: Request, { params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params
  const rl = rateLimit(`lookup:${orderNumber}`, 5, 10 * 60 * 1000)
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts, try later" }, { status: 429 })
  const body = await request.json()
  const parsed = orderLookupSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const order = await getOrderByNumber(orderNumber)
  if (!order || order.customer_email.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }

  return NextResponse.json({
    order_number: order.order_number,
    status: order.status,
    items: order.items,
    shipping_address: order.shipping_address,
    subtotal_cents: order.subtotal_cents,
    shipping_cents: order.shipping_cents,
    total_cents: order.total_cents,
    tracking_number: order.tracking_number,
    tracking_url: order.tracking_url,
    carrier: order.carrier,
    created_at: order.created_at,
    shipped_at: order.shipped_at,
  })
}
```

- [ ] **Step 27.3: Implement page**

Client component with a small email form. On submit, POST the lookup API; if 200, render the order status; if 404/429, show error message.

- [ ] **Step 27.4: Commit**

```bash
git add app/api/shop/orders app/(marketing)/shop/orders lib/shop/rate-limit.ts
git commit -m "feat(shop): add public order lookup with email gate and rate limiting"
```

---

## Task 28: E2E Playwright happy path

**Files:**
- Create: `__tests__/e2e/shop-happy-path.spec.ts`

- [ ] **Step 28.1: Verify Playwright config**

Run: `cat playwright.config.ts | head -40`
Confirm baseURL points to `http://localhost:3050` and webServer is configured to start `npm run dev`.

- [ ] **Step 28.2: Write spec**

```typescript
import { test, expect } from "@playwright/test"

test.describe("Shop happy path", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => { window.localStorage.clear() })
  })

  test("browse, cart, checkout up to Stripe redirect", async ({ page }) => {
    // Requires SHOP_ENABLED=true and at least one active product seeded
    await page.goto("/shop")
    await expect(page.getByRole("heading", { level: 1, name: /shop/i })).toBeVisible()

    const firstCard = page.locator("a[href^='/shop/']").first()
    await firstCard.click()

    const sizePicker = page.getByRole("radiogroup", { name: /size/i })
    if (await sizePicker.isVisible().catch(() => false)) {
      await sizePicker.locator("input").first().check()
    }

    await page.getByRole("button", { name: /add to cart/i }).click()
    await page.goto("/shop/cart")
    await page.getByRole("link", { name: /checkout/i }).click()

    await page.getByLabel(/name/i).fill("Test Buyer")
    await page.getByLabel(/email/i).fill("test@example.com")
    await page.getByLabel(/address/i).first().fill("123 Test St")
    await page.getByLabel(/city/i).fill("Austin")
    await page.getByLabel(/state/i).fill("TX")
    await page.getByLabel(/country/i).fill("US")
    await page.getByLabel(/postal/i).fill("78701")

    // Intercept quote to avoid real Printful call
    await page.route("**/api/shop/quote", async (route) => {
      await route.fulfill({ json: { shipping_cents: 499, shipping_label: "Standard", subtotal_cents: 2500, total_cents: 2999 } })
    })
    await page.getByRole("button", { name: /get quote|continue/i }).click()
    await expect(page.getByText(/\$29\.99/)).toBeVisible()

    // Intercept checkout to verify body only — don't actually redirect to Stripe
    let postBody: unknown = null
    await page.route("**/api/shop/checkout", async (route) => {
      postBody = route.request().postDataJSON()
      await route.fulfill({ json: { url: "https://checkout.stripe.com/test", order_number: "DJP-TESTTEST" } })
    })
    await page.getByRole("button", { name: /pay with stripe/i }).click()
    expect(postBody).toMatchObject({ shipping_cents: 499 })
  })
})
```

- [ ] **Step 28.3: Run E2E**

Run: `npm run test:e2e -- shop-happy-path`
Expected: PASS (requires local dev server with `SHOP_ENABLED=true` and seeded product).

- [ ] **Step 28.4: Commit**

```bash
git add __tests__/e2e/shop-happy-path.spec.ts
git commit -m "test(shop): add Playwright happy-path E2E"
```

---

## Task 29: Launch checklist

**Files:**
- Create: `docs/superpowers/plans/2026-04-17-merch-shop-printful-LAUNCH-CHECKLIST.md`

- [ ] **Step 29.1: Write launch checklist**

Bullet list with checkboxes. Include:
- Printful live API key set in prod
- Printful webhook URL registered in Printful dashboard → `https://<domain>/api/shop/webhooks/printful`
- Stripe webhook URL already registered; confirm `checkout.session.completed` still included
- `SHOP_ENABLED=false` in prod (leave false initially)
- Seed products in Printful, run admin sync, activate 1–2 products
- Internal end-to-end test: staff checkout with real Stripe test card + Printful sandbox
- Switch Printful to live, run one real staff order, verify shipping label + tracking email
- Flip `SHOP_ENABLED=true`
- Retire old iframe page (delete if archived) and any links to it
- Monitor Stripe dashboard, Printful dashboard, and app logs for 48 hours

- [ ] **Step 29.2: Commit**

```bash
git add docs/superpowers/plans
git commit -m "docs(shop): add launch checklist"
```

---

## Final Verification

- [ ] Run: `npm run lint` — no errors
- [ ] Run: `npm run test:run` — all tests pass
- [ ] Run: `npm run build` — production build succeeds
- [ ] Run: `npm run dev`, log in as admin, walk through full flow: sync products, activate one, toggle `SHOP_ENABLED=true` in `.env.local`, browse `/shop`, add to cart, checkout with Stripe test card, verify webhook fires, verify order in `/admin/shop/orders`, click Confirm, verify Printful sandbox order created, simulate Printful webhook for `package_shipped`, verify email received and `/shop/orders/[orderNumber]` shows tracking.
