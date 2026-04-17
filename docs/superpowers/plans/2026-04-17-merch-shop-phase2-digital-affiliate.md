# Merch Shop Phase 2 — Digital PDFs & Amazon Affiliate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v1 Printful POD shop with two new `product_type` values (`digital`, `affiliate`) that share the existing catalog/cart/admin UI. Digital products deliver signed PDF links via Stripe webhook (paid) or email form (free lead magnet). Affiliate products redirect externally to Amazon with click tracking.

**Architecture:** One unified spec — `product_type` enum on `shop_products`. Digital products auto-create a single variant row for cart/order uniformity; affiliate products never enter cart. Three independent feature flags (`SHOP_ENABLED`, `SHOP_DIGITAL_ENABLED`, `SHOP_AFFILIATE_ENABLED`) let each type roll out separately. Build order: foundation → affiliate (lower risk, ships first) → digital (full fulfillment pipeline).

**Tech Stack:** Next.js 16 App Router, Supabase PostgreSQL, Stripe Checkout, Firebase Admin SDK (signed URLs + private bucket), Resend (audiences + transactional), Vitest + Playwright.

**Reference:** [2026-04-17-merch-shop-phase2-digital-affiliate-design.md](../specs/2026-04-17-merch-shop-phase2-digital-affiliate-design.md)

---

## Phase 0 — Shared Foundation

Foundation migrations, type extensions, validators, and env-var plumbing. Both Phase 1 and Phase 2 depend on this. Phase 0 on its own is invisible to users.

### Task 1: Migration — product_type enum + shop_products columns

**Files:**
- Create: `supabase/migrations/00067_shop_product_type.sql`
- Test: `__tests__/migrations/00067_shop_product_type.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00067_shop_product_type.sql
-- Phase 2: introduce product_type discriminator + per-type columns

CREATE TYPE product_type AS ENUM ('pod', 'digital', 'affiliate');

ALTER TABLE shop_products
  ADD COLUMN product_type product_type NOT NULL DEFAULT 'pod',
  ADD COLUMN affiliate_url                  text,
  ADD COLUMN affiliate_asin                 text,
  ADD COLUMN affiliate_price_cents          integer,
  ADD COLUMN digital_access_days            integer,
  ADD COLUMN digital_signed_url_ttl_seconds integer NOT NULL DEFAULT 900,
  ADD COLUMN digital_max_downloads          integer,
  ADD COLUMN digital_is_free                boolean NOT NULL DEFAULT false;

-- printful_sync_id becomes nullable (digital/affiliate products have no sync id).
ALTER TABLE shop_products ALTER COLUMN printful_sync_id DROP NOT NULL;

CREATE INDEX idx_shop_products_type ON shop_products(product_type);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db reset` (or Supabase CLI equivalent in your setup).
Expected: migration applies cleanly; existing POD rows keep `product_type='pod'`.

- [ ] **Step 3: Write migration smoke test**

```ts
// __tests__/migrations/00067_shop_product_type.test.ts
import { describe, it, expect } from "vitest"
import { createServiceRoleClient } from "@/lib/supabase"

describe("migration 00067 shop_product_type", () => {
  it("exposes product_type column with default 'pod'", async () => {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("shop_products")
      .select("product_type, digital_is_free, digital_signed_url_ttl_seconds")
      .limit(1)
    expect(error).toBeNull()
    if (data && data.length > 0) {
      expect(data[0].product_type).toBe("pod")
      expect(data[0].digital_is_free).toBe(false)
      expect(data[0].digital_signed_url_ttl_seconds).toBe(900)
    }
  })
})
```

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- __tests__/migrations/00067_shop_product_type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00067_shop_product_type.sql __tests__/migrations/00067_shop_product_type.test.ts
git commit -m "feat(shop): add product_type enum and per-type columns"
```

---

### Task 2: Migration — fulfilled_digital status value

**Files:**
- Create: `supabase/migrations/00068_shop_order_status_fulfilled_digital.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00068_shop_order_status_fulfilled_digital.sql
-- Phase 2: digital-only orders skip POD states and terminate at 'fulfilled_digital'.

ALTER TYPE shop_order_status ADD VALUE IF NOT EXISTS 'fulfilled_digital';
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db reset`
Expected: migration succeeds.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00068_shop_order_status_fulfilled_digital.sql
git commit -m "feat(shop): add fulfilled_digital order status"
```

---

### Task 3: Extend types/database.ts

**Files:**
- Modify: `types/database.ts:757-780`

- [ ] **Step 1: Add ProductType + extend ShopOrderStatus + ShopProduct**

Replace the existing `ShopOrderStatus` type and `ShopProduct` interface with:

```ts
export type ProductType = "pod" | "digital" | "affiliate"

export type ShopOrderStatus =
  | "pending"
  | "paid"
  | "draft"
  | "confirmed"
  | "in_production"
  | "shipped"
  | "canceled"
  | "refunded"
  | "fulfilled_digital"

export interface ShopProduct {
  id: string
  printful_sync_id: number | null
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
  product_type: ProductType
  affiliate_url: string | null
  affiliate_asin: string | null
  affiliate_price_cents: number | null
  digital_access_days: number | null
  digital_signed_url_ttl_seconds: number
  digital_max_downloads: number | null
  digital_is_free: boolean
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors, or only pre-existing unrelated errors.

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(shop): extend ShopProduct and ShopOrderStatus types"
```

---

### Task 4: Extend feature-flag helpers

**Files:**
- Modify: `lib/shop/feature-flag.ts`
- Test: `__tests__/lib/shop/feature-flag.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/shop/feature-flag.test.ts
import { afterEach, describe, expect, it } from "vitest"
import {
  isShopEnabled,
  isShopDigitalEnabled,
  isShopAffiliateEnabled,
} from "@/lib/shop/feature-flag"

describe("shop feature flags", () => {
  const origEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it("isShopDigitalEnabled returns true only when env is 'true'", () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    expect(isShopDigitalEnabled()).toBe(true)
    process.env.SHOP_DIGITAL_ENABLED = "false"
    expect(isShopDigitalEnabled()).toBe(false)
    delete process.env.SHOP_DIGITAL_ENABLED
    expect(isShopDigitalEnabled()).toBe(false)
  })

  it("isShopAffiliateEnabled returns true only when env is 'true'", () => {
    process.env.SHOP_AFFILIATE_ENABLED = "true"
    expect(isShopAffiliateEnabled()).toBe(true)
    process.env.SHOP_AFFILIATE_ENABLED = "false"
    expect(isShopAffiliateEnabled()).toBe(false)
  })

  it("isShopEnabled remains independent", () => {
    process.env.SHOP_ENABLED = "true"
    expect(isShopEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test:run -- __tests__/lib/shop/feature-flag.test.ts`
Expected: FAIL (exports not defined).

- [ ] **Step 3: Implement the helpers**

Replace `lib/shop/feature-flag.ts` contents with:

```ts
export function isShopEnabled(): boolean {
  return process.env.SHOP_ENABLED === "true"
}

export function isShopDigitalEnabled(): boolean {
  return process.env.SHOP_DIGITAL_ENABLED === "true"
}

export function isShopAffiliateEnabled(): boolean {
  return process.env.SHOP_AFFILIATE_ENABLED === "true"
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test:run -- __tests__/lib/shop/feature-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shop/feature-flag.ts __tests__/lib/shop/feature-flag.test.ts
git commit -m "feat(shop): add digital + affiliate feature flags"
```

---

### Task 5: Zod validators for Phase 2

**Files:**
- Create: `lib/validators/shop-phase2.ts`
- Test: `__tests__/lib/validators/shop-phase2.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/validators/shop-phase2.test.ts
import { describe, expect, it } from "vitest"
import {
  affiliateProductInputSchema,
  digitalProductInputSchema,
  leadFormSchema,
  downloadSignRequestSchema,
} from "@/lib/validators/shop-phase2"

describe("affiliateProductInputSchema", () => {
  const base = {
    name: "Amazon Protein Powder",
    slug: "amazon-protein-powder",
    description: "<p>Great protein</p>",
    affiliate_url: "https://www.amazon.com/dp/B01N5IB20Q",
    thumbnail_url: "https://example.com/img.jpg",
  }

  it("accepts a valid amazon URL", () => {
    const r = affiliateProductInputSchema.safeParse(base)
    expect(r.success).toBe(true)
  })

  it("rejects a non-amazon host", () => {
    const r = affiliateProductInputSchema.safeParse({
      ...base,
      affiliate_url: "https://walmart.com/item/123",
    })
    expect(r.success).toBe(false)
  })

  it("accepts optional asin + price", () => {
    const r = affiliateProductInputSchema.safeParse({
      ...base,
      affiliate_asin: "B01N5IB20Q",
      affiliate_price_cents: 2499,
    })
    expect(r.success).toBe(true)
  })
})

describe("digitalProductInputSchema", () => {
  const paid = {
    name: "Comeback Code",
    slug: "comeback-code",
    description: "<p>12-week return to training</p>",
    digital_is_free: false,
    retail_price_cents: 4900,
    digital_signed_url_ttl_seconds: 900,
  }

  it("accepts a valid paid product", () => {
    expect(digitalProductInputSchema.safeParse(paid).success).toBe(true)
  })

  it("rejects paid product without price", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      retail_price_cents: undefined,
    })
    expect(r.success).toBe(false)
  })

  it("accepts free product without price", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      digital_is_free: true,
      retail_price_cents: undefined,
    })
    expect(r.success).toBe(true)
  })

  it("rejects ttl outside 60..86400", () => {
    const r = digitalProductInputSchema.safeParse({
      ...paid,
      digital_signed_url_ttl_seconds: 30,
    })
    expect(r.success).toBe(false)
  })
})

describe("leadFormSchema", () => {
  it("accepts valid email", () => {
    const r = leadFormSchema.safeParse({
      email: "user@example.com",
      product_id: "00000000-0000-0000-0000-000000000000",
      website: "",
    })
    expect(r.success).toBe(true)
  })

  it("rejects if honeypot 'website' is filled", () => {
    const r = leadFormSchema.safeParse({
      email: "user@example.com",
      product_id: "00000000-0000-0000-0000-000000000000",
      website: "http://spam.com",
    })
    expect(r.success).toBe(false)
  })
})

describe("downloadSignRequestSchema", () => {
  it("accepts valid payload", () => {
    const r = downloadSignRequestSchema.safeParse({
      order_number: "DJP-1042",
      email: "user@example.com",
      download_id: "00000000-0000-0000-0000-000000000000",
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm run test:run -- __tests__/lib/validators/shop-phase2.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement validators**

```ts
// lib/validators/shop-phase2.ts
import { z } from "zod"

const AMAZON_HOST_REGEX = /^(?:www\.)?amazon\.[a-z.]{2,6}$/i

export const affiliateProductInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
  description: z.string().default(""),
  thumbnail_url: z.string().url(),
  affiliate_url: z
    .string()
    .url()
    .refine((raw) => {
      try {
        const u = new URL(raw)
        return AMAZON_HOST_REGEX.test(u.hostname)
      } catch {
        return false
      }
    }, "affiliate_url must be an amazon.* URL"),
  affiliate_asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  affiliate_price_cents: z.number().int().positive().optional(),
})

export type AffiliateProductInput = z.infer<typeof affiliateProductInputSchema>

export const digitalProductInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
    description: z.string().default(""),
    thumbnail_url: z.string().url().optional(),
    digital_is_free: z.boolean(),
    retail_price_cents: z.number().int().positive().optional(),
    digital_access_days: z.number().int().positive().nullable().optional(),
    digital_signed_url_ttl_seconds: z
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(900),
    digital_max_downloads: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (v) => v.digital_is_free || (v.retail_price_cents && v.retail_price_cents > 0),
    { message: "retail_price_cents required for paid digital products" },
  )

export type DigitalProductInput = z.infer<typeof digitalProductInputSchema>

export const leadFormSchema = z.object({
  email: z.string().email().max(254),
  product_id: z.string().uuid(),
  // Honeypot — must be empty.
  website: z.string().max(0, "bot detected"),
})

export type LeadForm = z.infer<typeof leadFormSchema>

export const downloadSignRequestSchema = z.object({
  order_number: z.string().min(1).max(40),
  email: z.string().email(),
  download_id: z.string().uuid(),
})

export type DownloadSignRequest = z.infer<typeof downloadSignRequestSchema>
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm run test:run -- __tests__/lib/validators/shop-phase2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/shop-phase2.ts __tests__/lib/validators/shop-phase2.test.ts
git commit -m "feat(shop): add phase-2 zod validators"
```

---

### Task 6: Env-var plumbing

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append new env vars**

Add to `.env.example`:

```
# ---- Shop Phase 2 ----
AMAZON_ASSOCIATES_TAG=djp-20
FIREBASE_PRIVATE_BUCKET=djp-athlete-downloads
RESEND_AUDIENCE_ID=
SHOP_DIGITAL_ENABLED=false
SHOP_AFFILIATE_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore(shop): document phase-2 env vars"
```

---

### Task 7: Phase 0 checkpoint

- [ ] **Step 1: Verify full test suite still green**

Run: `npm run test:run`
Expected: PASS (only pre-existing failures, if any, remain).

- [ ] **Step 2: Push to remote branch (or leave for review)**

```bash
git status
# (optional) git push origin HEAD
```

---

## Phase 1 — Amazon Affiliate

Smallest, lowest-risk subsystem. Ships first behind `SHOP_AFFILIATE_ENABLED`.

### Task 8: Migration — shop_affiliate_clicks

**Files:**
- Create: `supabase/migrations/00069_shop_affiliate_clicks.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00069_shop_affiliate_clicks.sql
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
-- Service role only: no policies created.
```

- [ ] **Step 2: Apply + commit**

Run: `npx supabase db reset`
Then:
```bash
git add supabase/migrations/00069_shop_affiliate_clicks.sql
git commit -m "feat(shop): create shop_affiliate_clicks table"
```

---

### Task 9: DAL — shop-affiliate-clicks

**Files:**
- Create: `lib/db/shop-affiliate-clicks.ts`
- Test: `__tests__/lib/db/shop-affiliate-clicks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/db/shop-affiliate-clicks.test.ts
import { describe, expect, it, beforeEach } from "vitest"
import {
  recordAffiliateClick,
  countClicksForProduct,
  countClicksForProductSince,
} from "@/lib/db/shop-affiliate-clicks"
import { createServiceRoleClient } from "@/lib/supabase"

describe("shop-affiliate-clicks DAL", () => {
  let productId: string

  beforeEach(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `test-aff-${Date.now()}`,
        name: "test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "affiliate",
        affiliate_url: "https://amazon.com/dp/B000",
      })
      .select("id")
      .single()
    productId = data!.id
  })

  it("records a click and counts it", async () => {
    await recordAffiliateClick({
      product_id: productId,
      ip_address: "1.2.3.4",
      user_agent: "ua",
      referrer: null,
    })
    expect(await countClicksForProduct(productId)).toBe(1)
  })

  it("counts clicks since a timestamp", async () => {
    await recordAffiliateClick({ product_id: productId })
    const since = new Date(Date.now() - 60_000).toISOString()
    const count = await countClicksForProductSince(productId, since)
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm run test:run -- __tests__/lib/db/shop-affiliate-clicks.test.ts`

- [ ] **Step 3: Implement DAL**

```ts
// lib/db/shop-affiliate-clicks.ts
import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export async function recordAffiliateClick(input: {
  product_id: string
  ip_address?: string | null
  user_agent?: string | null
  referrer?: string | null
}) {
  const supabase = getClient()
  const { error } = await supabase.from("shop_affiliate_clicks").insert({
    product_id: input.product_id,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    referrer: input.referrer ?? null,
  })
  if (error) throw error
}

export async function countClicksForProduct(productId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_affiliate_clicks")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
  if (error) throw error
  return count ?? 0
}

export async function countClicksForProductSince(
  productId: string,
  sinceIso: string,
): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_affiliate_clicks")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
    .gte("clicked_at", sinceIso)
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/db/shop-affiliate-clicks.ts __tests__/lib/db/shop-affiliate-clicks.test.ts
git commit -m "feat(shop): add affiliate-clicks DAL"
```

---

### Task 10: lib/shop/amazon.ts — URL builder

**Files:**
- Create: `lib/shop/amazon.ts`
- Test: `__tests__/lib/shop/amazon.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/shop/amazon.test.ts
import { describe, expect, it } from "vitest"
import { buildAffiliateUrl, extractAsin } from "@/lib/shop/amazon"

describe("buildAffiliateUrl", () => {
  it("appends tag when absent", () => {
    const out = buildAffiliateUrl("https://www.amazon.com/dp/B01N5IB20Q", "djp-20")
    expect(out).toContain("tag=djp-20")
    expect(out).toContain("/dp/B01N5IB20Q")
  })

  it("replaces existing tag", () => {
    const out = buildAffiliateUrl(
      "https://www.amazon.com/dp/B01N5IB20Q?tag=other-20",
      "djp-20",
    )
    expect(out).toContain("tag=djp-20")
    expect(out).not.toContain("tag=other-20")
  })

  it("throws on non-amazon host", () => {
    expect(() =>
      buildAffiliateUrl("https://walmart.com/item/1", "djp-20"),
    ).toThrow()
  })

  it("throws on malformed URL", () => {
    expect(() => buildAffiliateUrl("not a url", "djp-20")).toThrow()
  })
})

describe("extractAsin", () => {
  it("extracts from /dp/ path", () => {
    expect(extractAsin("https://www.amazon.com/dp/B01N5IB20Q")).toBe("B01N5IB20Q")
  })

  it("extracts from /gp/product/ path", () => {
    expect(
      extractAsin("https://www.amazon.com/gp/product/B01N5IB20Q/ref=sr"),
    ).toBe("B01N5IB20Q")
  })

  it("returns null when absent", () => {
    expect(extractAsin("https://www.amazon.com/s?k=protein")).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// lib/shop/amazon.ts
const AMAZON_HOST_REGEX = /^(?:www\.)?amazon\.[a-z.]{2,6}$/i
const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/

export function buildAffiliateUrl(rawUrl: string, tag: string): string {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`invalid affiliate URL: ${rawUrl}`)
  }
  if (!AMAZON_HOST_REGEX.test(u.hostname)) {
    throw new Error(`non-amazon host in affiliate URL: ${u.hostname}`)
  }
  u.searchParams.delete("tag")
  u.searchParams.set("tag", tag)
  return u.toString()
}

export function extractAsin(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    const m = u.pathname.match(ASIN_REGEX)
    return m ? m[1] : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/shop/amazon.ts __tests__/lib/shop/amazon.test.ts
git commit -m "feat(shop): add amazon affiliate URL builder"
```

---

### Task 11: Public redirect route /shop/go/[productId]

**Files:**
- Create: `app/(marketing)/shop/go/[productId]/route.ts`
- Test: `__tests__/api/shop/go.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/shop/go.test.ts
import { describe, expect, it, beforeAll } from "vitest"
import { GET } from "@/app/(marketing)/shop/go/[productId]/route"
import { createServiceRoleClient } from "@/lib/supabase"

describe("GET /shop/go/[productId]", () => {
  let productId: string

  beforeAll(async () => {
    process.env.AMAZON_ASSOCIATES_TAG = "djp-20"
    process.env.SHOP_AFFILIATE_ENABLED = "true"
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `go-test-${Date.now()}`,
        name: "go-test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "affiliate",
        affiliate_url: "https://www.amazon.com/dp/B000",
        is_active: true,
      })
      .select("id")
      .single()
    productId = data!.id
  })

  it("302-redirects with tag appended", async () => {
    const req = new Request("http://localhost/shop/go/" + productId)
    const res = await GET(req, { params: Promise.resolve({ productId }) })
    expect(res.status).toBe(307) // Next.js redirect() default, or 302 if Response.redirect
    const loc = res.headers.get("location")
    expect(loc).toContain("amazon.com/dp/B000")
    expect(loc).toContain("tag=djp-20")
  })

  it("404s when affiliate flag is off", async () => {
    process.env.SHOP_AFFILIATE_ENABLED = "false"
    const req = new Request("http://localhost/shop/go/" + productId)
    const res = await GET(req, { params: Promise.resolve({ productId }) })
    expect(res.status).toBe(404)
    process.env.SHOP_AFFILIATE_ENABLED = "true"
  })

  it("404s on unknown product", async () => {
    const req = new Request("http://localhost/shop/go/00000000-0000-0000-0000-000000000000")
    const res = await GET(req, {
      params: Promise.resolve({ productId: "00000000-0000-0000-0000-000000000000" }),
    })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route**

```ts
// app/(marketing)/shop/go/[productId]/route.ts
import { NextResponse } from "next/server"
import { getProductById } from "@/lib/db/shop-products"
import { recordAffiliateClick } from "@/lib/db/shop-affiliate-clicks"
import { buildAffiliateUrl } from "@/lib/shop/amazon"
import { isShopAffiliateEnabled } from "@/lib/shop/feature-flag"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (!isShopAffiliateEnabled()) {
    return new NextResponse("Not found", { status: 404 })
  }
  const { productId } = await params
  const product = await getProductById(productId)
  if (!product || product.product_type !== "affiliate" || !product.affiliate_url) {
    return new NextResponse("Not found", { status: 404 })
  }

  const tag = process.env.AMAZON_ASSOCIATES_TAG
  if (!tag) {
    return new NextResponse("Affiliate not configured", { status: 500 })
  }

  let target: string
  try {
    target = buildAffiliateUrl(product.affiliate_url, tag)
  } catch {
    return new NextResponse("Invalid affiliate URL", { status: 400 })
  }

  // Fire-and-forget; don't block the redirect on the log.
  recordAffiliateClick({
    product_id: product.id,
    ip_address: req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
    referrer: req.headers.get("referer"),
  }).catch((e) => console.error("affiliate-click log failed", e))

  const res = NextResponse.redirect(target, 307)
  res.headers.set("X-Robots-Tag", "noindex, nofollow")
  return res
}

export const dynamic = "force-dynamic"
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/\(marketing\)/shop/go __tests__/api/shop/go.test.ts
git commit -m "feat(shop): add /shop/go affiliate redirect with click tracking"
```

---

### Task 12: Extend shop-products DAL with createAffiliateProduct

**Files:**
- Modify: `lib/db/shop-products.ts`
- Test: `__tests__/lib/db/shop-products-affiliate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/db/shop-products-affiliate.test.ts
import { describe, expect, it } from "vitest"
import {
  createAffiliateProduct,
  listProductsByType,
} from "@/lib/db/shop-products"

describe("createAffiliateProduct", () => {
  it("creates with product_type='affiliate'", async () => {
    const product = await createAffiliateProduct({
      name: "Test Aff " + Date.now(),
      slug: "test-aff-" + Date.now(),
      description: "<p>hi</p>",
      thumbnail_url: "https://x/img.jpg",
      affiliate_url: "https://www.amazon.com/dp/B000",
      affiliate_asin: "B000XXXXXX",
      affiliate_price_cents: 1999,
    })
    expect(product.product_type).toBe("affiliate")
    expect(product.affiliate_url).toContain("amazon.com")
    expect(product.is_active).toBe(false)
  })
})

describe("listProductsByType", () => {
  it("filters by type", async () => {
    const list = await listProductsByType("affiliate")
    expect(list.every((p) => p.product_type === "affiliate")).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add functions to `lib/db/shop-products.ts`**

Append:

```ts
import type { ProductType } from "@/types/database"

export async function createAffiliateProduct(input: {
  name: string
  slug: string
  description: string
  thumbnail_url: string
  affiliate_url: string
  affiliate_asin?: string | null
  affiliate_price_cents?: number | null
}): Promise<ShopProduct> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description,
      thumbnail_url: input.thumbnail_url,
      product_type: "affiliate",
      affiliate_url: input.affiliate_url,
      affiliate_asin: input.affiliate_asin ?? null,
      affiliate_price_cents: input.affiliate_price_cents ?? null,
      is_active: false,
      is_featured: false,
      sort_order: 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as ShopProduct
}

export async function listProductsByType(type: ProductType): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("product_type", type)
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}

export async function listActiveProductsByType(
  type: ProductType,
): Promise<ShopProduct[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .select("*")
    .eq("product_type", type)
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
  if (error) throw error
  return data as ShopProduct[]
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/db/shop-products.ts __tests__/lib/db/shop-products-affiliate.test.ts
git commit -m "feat(shop): add createAffiliateProduct + type listing in DAL"
```

---

### Task 13: Admin products list — type badge + filter + split button

**Files:**
- Modify: `app/(admin)/admin/shop/products/page.tsx`
- Modify: `app/(admin)/admin/shop/products/ShopProductsTable.tsx`

- [ ] **Step 1: Add a type filter via searchParams**

Modify `app/(admin)/admin/shop/products/page.tsx` to read `?type=pod|digital|affiliate|all` from searchParams and pass a filtered list to the table. Replace the product fetch call:

```tsx
import { listAllProducts, listProductsByType } from "@/lib/db/shop-products"
import type { ProductType } from "@/types/database"

type PageProps = { searchParams: Promise<{ type?: string }> }

export default async function AdminShopProductsPage({ searchParams }: PageProps) {
  const { type } = await searchParams
  const filter = (type ?? "all") as ProductType | "all"
  const products =
    filter === "all" ? await listAllProducts() : await listProductsByType(filter)
  // ... pass filter + products to the client table component
}
```

- [ ] **Step 2: In the table component, render a Type badge column**

Modify `ShopProductsTable.tsx` to add a new column between name and price-range:

```tsx
<td className="px-3 py-2">
  <span
    className={cn(
      "inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
      product.product_type === "pod" && "bg-primary/10 text-primary",
      product.product_type === "digital" && "bg-accent/15 text-accent",
      product.product_type === "affiliate" && "bg-muted text-muted-foreground",
    )}
  >
    {product.product_type}
  </span>
</td>
```

Add a header cell matching.

- [ ] **Step 3: Add tab navigation (All / POD / Digital / Affiliate) above the table**

In `page.tsx`, above `<ShopProductsTable>`:

```tsx
<nav className="mb-4 flex gap-1 border-b border-border">
  {(["all", "pod", "digital", "affiliate"] as const).map((t) => (
    <Link
      key={t}
      href={t === "all" ? "/admin/shop/products" : `/admin/shop/products?type=${t}`}
      className={cn(
        "border-b-2 px-4 py-2 font-mono text-xs uppercase tracking-widest",
        filter === t
          ? "border-accent text-primary"
          : "border-transparent text-muted-foreground hover:text-primary",
      )}
    >
      {t}
    </Link>
  ))}
</nav>
```

- [ ] **Step 4: Add "Add product" split button**

In the header region of `page.tsx`:

```tsx
<div className="flex items-center gap-2">
  <SyncButton />
  <Link
    href="/admin/shop/products/new/digital"
    className="rounded-md border border-border px-3 py-1.5 font-body text-sm hover:bg-muted"
  >
    + Digital
  </Link>
  <Link
    href="/admin/shop/products/new/affiliate"
    className="rounded-md border border-border px-3 py-1.5 font-body text-sm hover:bg-muted"
  >
    + Affiliate
  </Link>
</div>
```

- [ ] **Step 5: Visual check**

Run: `npm run dev`
Open: `http://localhost:3050/admin/shop/products?type=affiliate`
Expected: list filters correctly; badge shows; buttons link to forms (which 404 until next tasks).

- [ ] **Step 6: Commit**

```bash
git add app/\(admin\)/admin/shop/products/page.tsx app/\(admin\)/admin/shop/products/ShopProductsTable.tsx
git commit -m "feat(admin-shop): add type filter, badge column, add-product menu"
```

---

### Task 14: Admin — new affiliate product form

**Files:**
- Create: `app/(admin)/admin/shop/products/new/affiliate/page.tsx`
- Create: `app/(admin)/admin/shop/products/new/affiliate/AffiliateProductForm.tsx`
- Create: `app/api/admin/shop/products/affiliate/route.ts`
- Test: `__tests__/api/admin/shop/products-affiliate.test.ts`

- [ ] **Step 1: Write failing API test**

```ts
// __tests__/api/admin/shop/products-affiliate.test.ts
import { describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/admin/shop/products/affiliate/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))

describe("POST /api/admin/shop/products/affiliate", () => {
  it("creates affiliate product on valid payload", async () => {
    const req = new Request("http://x/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify({
        name: "API Aff Test " + Date.now(),
        slug: "api-aff-" + Date.now(),
        description: "",
        thumbnail_url: "https://x/i.jpg",
        affiliate_url: "https://www.amazon.com/dp/B001",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.product.product_type).toBe("affiliate")
  })

  it("rejects non-amazon url", async () => {
    const req = new Request("http://x/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify({
        name: "x",
        slug: "x-" + Date.now(),
        description: "",
        thumbnail_url: "https://x/i.jpg",
        affiliate_url: "https://walmart.com/x",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement API route**

```ts
// app/api/admin/shop/products/affiliate/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { affiliateProductInputSchema } from "@/lib/validators/shop-phase2"
import { createAffiliateProduct } from "@/lib/db/shop-products"
import { extractAsin } from "@/lib/shop/amazon"

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = affiliateProductInputSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const v = parsed.data
  const product = await createAffiliateProduct({
    name: v.name,
    slug: v.slug,
    description: v.description,
    thumbnail_url: v.thumbnail_url,
    affiliate_url: v.affiliate_url,
    affiliate_asin: v.affiliate_asin ?? extractAsin(v.affiliate_url),
    affiliate_price_cents: v.affiliate_price_cents ?? null,
  })
  return NextResponse.json({ product })
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Build the client form**

```tsx
// app/(admin)/admin/shop/products/new/affiliate/AffiliateProductForm.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function AffiliateProductForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    const form = new FormData(e.currentTarget)
    const payload = {
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      description: String(form.get("description") ?? ""),
      thumbnail_url: String(form.get("thumbnail_url") ?? ""),
      affiliate_url: String(form.get("affiliate_url") ?? ""),
      affiliate_asin: String(form.get("affiliate_asin") ?? "") || undefined,
      affiliate_price_cents:
        form.get("affiliate_price_dollars")
          ? Math.round(Number(form.get("affiliate_price_dollars")) * 100)
          : undefined,
    }
    const res = await fetch("/api/admin/shop/products/affiliate", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error("Failed to create product")
      return
    }
    const { product } = await res.json()
    toast.success("Affiliate product created")
    router.push(`/admin/shop/products/${product.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Slug</span>
        <input name="slug" required pattern="[a-z0-9-]+" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Description</span>
        <textarea name="description" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Thumbnail URL</span>
        <input name="thumbnail_url" type="url" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Amazon URL</span>
        <input name="affiliate_url" type="url" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">ASIN (optional — auto-extracted if blank)</span>
        <input name="affiliate_asin" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm">Reference price (USD, optional)</span>
        <input name="affiliate_price_dollars" type="number" step="0.01" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create"}
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Build the page**

```tsx
// app/(admin)/admin/shop/products/new/affiliate/page.tsx
import { AffiliateProductForm } from "./AffiliateProductForm"

export default function NewAffiliateProductPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-heading text-2xl">New affiliate product</h1>
      <AffiliateProductForm />
    </div>
  )
}
```

- [ ] **Step 7: Visual check**

Run: `npm run dev`; open `/admin/shop/products/new/affiliate`; fill the form; submit; confirm navigation to the new product detail page.

- [ ] **Step 8: Commit**

```bash
git add app/\(admin\)/admin/shop/products/new/affiliate app/api/admin/shop/products/affiliate __tests__/api/admin/shop/products-affiliate.test.ts
git commit -m "feat(admin-shop): add new-affiliate-product form and API"
```

---

### Task 15: Admin product detail — affiliate panels

**Files:**
- Modify: `app/(admin)/admin/shop/products/[id]/page.tsx`

- [ ] **Step 1: Branch the product-detail page by product_type**

At the top of the page, after loading the product:

```tsx
import { countClicksForProduct, countClicksForProductSince } from "@/lib/db/shop-affiliate-clicks"
import { buildAffiliateUrl } from "@/lib/shop/amazon"

// ...inside the component, after `const product = await getProductById(id)`:
if (product.product_type === "affiliate") {
  const total = await countClicksForProduct(product.id)
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const c7 = await countClicksForProductSince(product.id, since7)
  const c30 = await countClicksForProductSince(product.id, since30)
  const tag = process.env.AMAZON_ASSOCIATES_TAG ?? ""
  const preview = product.affiliate_url && tag ? buildAffiliateUrl(product.affiliate_url, tag) : ""

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Identity panel — reuse existing name/slug/description/thumbnail panel */}
      {/* Link panel */}
      <section className="rounded-2xl border border-border p-6">
        <h2 className="mb-4 font-heading text-lg">Link</h2>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-muted-foreground">Amazon URL</dt><dd>{product.affiliate_url}</dd></div>
          <div><dt className="text-muted-foreground">ASIN</dt><dd>{product.affiliate_asin ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Reference price</dt>
               <dd>{product.affiliate_price_cents != null ? `$${(product.affiliate_price_cents/100).toFixed(2)}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Tagged URL preview</dt><dd className="break-all">{preview}</dd></div>
        </dl>
      </section>
      {/* Stats panel */}
      <section className="rounded-2xl border border-border p-6">
        <h2 className="mb-4 font-heading text-lg">Click stats</h2>
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div><dt className="text-xs uppercase text-muted-foreground">Total</dt><dd className="font-heading text-2xl">{total}</dd></div>
          <div><dt className="text-xs uppercase text-muted-foreground">Last 7d</dt><dd className="font-heading text-2xl">{c7}</dd></div>
          <div><dt className="text-xs uppercase text-muted-foreground">Last 30d</dt><dd className="font-heading text-2xl">{c30}</dd></div>
        </dl>
      </section>
    </div>
  )
}
```

Keep the existing POD-detail code path unchanged for `product_type === "pod"`.

- [ ] **Step 2: Visual check**

Create one affiliate product, generate 2–3 clicks via `/shop/go/[id]` (with `SHOP_AFFILIATE_ENABLED=true`), reload the admin detail page, confirm stats reflect clicks.

- [ ] **Step 3: Commit**

```bash
git add app/\(admin\)/admin/shop/products/\[id\]/page.tsx
git commit -m "feat(admin-shop): add affiliate detail panels (link + click stats)"
```

---

### Task 16: Public ProductCard — affiliate variant

**Files:**
- Modify: `components/public/shop/ProductCard.tsx`

- [ ] **Step 1: Branch on product_type**

At the top of the ProductCard component, detect affiliate and render an alternate CTA:

```tsx
import { ExternalLink } from "lucide-react"
// ...

if (product.product_type === "affiliate") {
  const price = product.affiliate_price_cents
  return (
    <a
      href={`/shop/go/${product.id}`}
      target="_blank"
      rel="nofollow sponsored noopener"
      className="group block"
    >
      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
        <img src={resolvedThumb} alt={product.name} className="h-full w-full object-cover" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm">{product.name}</h3>
          {price != null ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">~${(price/100).toFixed(2)}</p>
          ) : null}
        </div>
        <span className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent">
          Amazon <ExternalLink className="size-3" />
        </span>
      </div>
    </a>
  )
}

// existing POD rendering below...
```

- [ ] **Step 2: Visual check**

Set `SHOP_AFFILIATE_ENABLED=true`, activate an affiliate product, open `/shop`. Affiliate card opens `/shop/go/[id]` in a new tab and lands on Amazon with tag.

- [ ] **Step 3: Commit**

```bash
git add components/public/shop/ProductCard.tsx
git commit -m "feat(shop): render affiliate card with external amazon link"
```

---

### Task 17: Public PDP — affiliate branch + flag-gated 404

**Files:**
- Modify: `app/(marketing)/shop/[slug]/page.tsx`
- Modify: `app/(marketing)/shop/page.tsx`

- [ ] **Step 1: In the grid page, filter out disabled types**

Inside `app/(marketing)/shop/page.tsx` where `products` is built, before rendering, filter affiliate products when the flag is off:

```tsx
import { isShopAffiliateEnabled, isShopDigitalEnabled } from "@/lib/shop/feature-flag"

const affOn = isShopAffiliateEnabled()
const digOn = isShopDigitalEnabled()
const visible = products.filter((p) => {
  if (p.product_type === "affiliate") return affOn
  if (p.product_type === "digital") return digOn
  return true
})
// use `visible` instead of `products` downstream
```

- [ ] **Step 2: In the PDP, 404 on disabled types**

At the top of `app/(marketing)/shop/[slug]/page.tsx`, after loading the product:

```tsx
import { notFound } from "next/navigation"
import { isShopAffiliateEnabled, isShopDigitalEnabled } from "@/lib/shop/feature-flag"

if (product.product_type === "affiliate" && !isShopAffiliateEnabled()) notFound()
if (product.product_type === "digital" && !isShopDigitalEnabled()) notFound()
```

- [ ] **Step 3: Render the affiliate PDP variant**

If `product.product_type === "affiliate"`, render a simplified PDP with no variant picker and a large "View on Amazon" button that links to `/shop/go/[product.id]`. Place this branch above the existing POD rendering:

```tsx
if (product.product_type === "affiliate") {
  return (
    <article className="mx-auto max-w-5xl px-4 py-12">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <img src={product.thumbnail_url_override ?? product.thumbnail_url} alt={product.name} className="w-full rounded-2xl" />
        <div>
          <h1 className="font-heading text-3xl">{product.name}</h1>
          {product.affiliate_price_cents != null ? (
            <p className="mt-2 text-muted-foreground">Approx. ${(product.affiliate_price_cents/100).toFixed(2)}</p>
          ) : null}
          <div className="prose mt-6" dangerouslySetInnerHTML={{ __html: product.description }} />
          <a
            href={`/shop/go/${product.id}`}
            target="_blank"
            rel="nofollow sponsored noopener"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground"
          >
            View on Amazon →
          </a>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            As an Amazon Associate, DJP Athlete earns from qualifying purchases.
          </p>
        </div>
      </div>
    </article>
  )
}
```

- [ ] **Step 4: Visual check**

With `SHOP_AFFILIATE_ENABLED=true`: visit the affiliate product PDP → see the alternate layout. With `SHOP_AFFILIATE_ENABLED=false`: visit the same slug → 404.

- [ ] **Step 5: Commit**

```bash
git add app/\(marketing\)/shop/\[slug\]/page.tsx app/\(marketing\)/shop/page.tsx
git commit -m "feat(shop): render affiliate PDP and gate types by flag"
```

---

### Task 18: E2E — affiliate click redirects to amazon with tag

**Files:**
- Create: `__tests__/e2e/shop-affiliate.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

```ts
// __tests__/e2e/shop-affiliate.spec.ts
import { test, expect } from "@playwright/test"

// This test assumes: SHOP_ENABLED=true, SHOP_AFFILIATE_ENABLED=true,
// and at least one active affiliate product exists in the DB with slug "e2e-aff".
test("affiliate card redirects to amazon with tag", async ({ page, context }) => {
  await page.goto("/shop")
  const pagePromise = context.waitForEvent("page")
  await page.getByRole("link", { name: /e2e-aff|amazon/i }).first().click()
  const newPage = await pagePromise
  await newPage.waitForURL(/amazon\./)
  expect(newPage.url()).toContain("tag=")
})
```

- [ ] **Step 2: Run against a local dev server**

Seed one affiliate product (can be done via admin UI manually):

Run: `npm run test:e2e -- __tests__/e2e/shop-affiliate.spec.ts`
Expected: PASS on Chromium at minimum.

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/shop-affiliate.spec.ts
git commit -m "test(shop): e2e affiliate redirect"
```

---

### Task 19: Phase 1 checkpoint — affiliate is shippable

- [ ] **Step 1: Run full test suite**

Run: `npm run test:run`
Expected: green (or only pre-existing failures).

- [ ] **Step 2: Manual sanity in dev**

- Create one affiliate product in admin.
- Activate it.
- Set flags `SHOP_ENABLED=true`, `SHOP_AFFILIATE_ENABLED=true`.
- Visit `/shop`, click the card, confirm Amazon opens with `tag=`.
- Visit admin product detail, confirm click count increments.

- [ ] **Step 3: Push to branch**

```bash
git status
git log --oneline -20
# Optional push: git push origin HEAD
```

At this point the affiliate feature can be merged and shipped independently. Phase 2 below adds digital PDFs.

---

## Phase 2 — Digital PDFs

Adds paid + free digital products, file management, Stripe-webhook-driven fulfillment, signed-URL downloads, free-PDF lead capture, and admin leads page.

### Task 20: Migration — shop_product_files

**Files:**
- Create: `supabase/migrations/00070_shop_product_files.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/00070_shop_product_files.sql
CREATE TABLE shop_product_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  display_name    text NOT NULL,
  storage_path    text NOT NULL,
  file_size_bytes bigint NOT NULL,
  mime_type       text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_product_files_product ON shop_product_files(product_id);

ALTER TABLE shop_product_files ENABLE ROW LEVEL SECURITY;
-- service role only
```

- [ ] **Step 2: Apply + commit**

```bash
npx supabase db reset
git add supabase/migrations/00070_shop_product_files.sql
git commit -m "feat(shop): create shop_product_files table"
```

---

### Task 21: Migration — shop_order_downloads

**Files:**
- Create: `supabase/migrations/00071_shop_order_downloads.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/00071_shop_order_downloads.sql
CREATE TABLE shop_order_downloads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id         uuid NOT NULL REFERENCES shop_products(id),
  file_id            uuid NOT NULL REFERENCES shop_product_files(id),
  access_expires_at  timestamptz,
  download_count     integer NOT NULL DEFAULT 0,
  max_downloads      integer,
  last_downloaded_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_shop_order_downloads_order_file
  ON shop_order_downloads(order_id, file_id);
CREATE INDEX idx_shop_order_downloads_order ON shop_order_downloads(order_id);

ALTER TABLE shop_order_downloads ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply + commit**

```bash
npx supabase db reset
git add supabase/migrations/00071_shop_order_downloads.sql
git commit -m "feat(shop): create shop_order_downloads table"
```

---

### Task 22: Migration — shop_leads

**Files:**
- Create: `supabase/migrations/00072_shop_leads.sql`

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/00072_shop_leads.sql
CREATE TABLE shop_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES shop_products(id),
  email               text NOT NULL,
  resend_contact_id   text,
  resend_sync_status  text NOT NULL DEFAULT 'pending',
  resend_sync_error   text,
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, email)
);

CREATE INDEX idx_shop_leads_product ON shop_leads(product_id);
CREATE INDEX idx_shop_leads_created ON shop_leads(created_at DESC);

ALTER TABLE shop_leads ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply + commit**

```bash
npx supabase db reset
git add supabase/migrations/00072_shop_leads.sql
git commit -m "feat(shop): create shop_leads table"
```

---

### Task 23: DAL — shop-product-files

**Files:**
- Create: `lib/db/shop-product-files.ts`
- Test: `__tests__/lib/db/shop-product-files.test.ts`

- [ ] **Step 1: Add interface to types/database.ts**

After the existing `ShopProductVariant` interface, add:

```ts
export interface ShopProductFile {
  id: string
  product_id: string
  file_name: string
  display_name: string
  storage_path: string
  file_size_bytes: number
  mime_type: string
  sort_order: number
  created_at: string
}
```

- [ ] **Step 2: Write failing test**

```ts
// __tests__/lib/db/shop-product-files.test.ts
import { describe, expect, it, beforeAll } from "vitest"
import {
  attachFileToProduct,
  listFilesForProduct,
  deleteProductFile,
} from "@/lib/db/shop-product-files"
import { createServiceRoleClient } from "@/lib/supabase"

describe("shop-product-files DAL", () => {
  let productId: string

  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `digi-${Date.now()}`,
        name: "digital test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
      })
      .select("id")
      .single()
    productId = data!.id
  })

  it("attaches + lists + deletes a file", async () => {
    const file = await attachFileToProduct({
      product_id: productId,
      file_name: "x.pdf",
      display_name: "X",
      storage_path: "downloads/x.pdf",
      file_size_bytes: 1234,
      mime_type: "application/pdf",
    })
    expect(file.id).toBeTruthy()

    const list = await listFilesForProduct(productId)
    expect(list.some((f) => f.id === file.id)).toBe(true)

    await deleteProductFile(file.id)
    const after = await listFilesForProduct(productId)
    expect(after.some((f) => f.id === file.id)).toBe(false)
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement DAL**

```ts
// lib/db/shop-product-files.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopProductFile } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function attachFileToProduct(input: {
  product_id: string
  file_name: string
  display_name: string
  storage_path: string
  file_size_bytes: number
  mime_type: string
  sort_order?: number
}): Promise<ShopProductFile> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .insert({ ...input, sort_order: input.sort_order ?? 0 })
    .select()
    .single()
  if (error) throw error
  return data as ShopProductFile
}

export async function listFilesForProduct(
  productId: string,
): Promise<ShopProductFile[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .select("*")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw error
  return data as ShopProductFile[]
}

export async function getProductFile(fileId: string): Promise<ShopProductFile | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_files")
    .select("*")
    .eq("id", fileId)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopProductFile
}

export async function updateProductFile(
  fileId: string,
  updates: Partial<Pick<ShopProductFile, "display_name" | "sort_order">>,
) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_product_files")
    .update(updates)
    .eq("id", fileId)
  if (error) throw error
}

export async function deleteProductFile(fileId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_product_files")
    .delete()
    .eq("id", fileId)
  if (error) throw error
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add lib/db/shop-product-files.ts types/database.ts __tests__/lib/db/shop-product-files.test.ts
git commit -m "feat(shop): add shop-product-files DAL"
```

---

### Task 24: DAL — shop-order-downloads with atomic increment

**Files:**
- Create: `lib/db/shop-order-downloads.ts`
- Test: `__tests__/lib/db/shop-order-downloads.test.ts`
- Create SQL helper: `supabase/migrations/00073_increment_download_count_fn.sql`

- [ ] **Step 1: Add interface to types/database.ts**

```ts
export interface ShopOrderDownload {
  id: string
  order_id: string
  product_id: string
  file_id: string
  access_expires_at: string | null
  download_count: number
  max_downloads: number | null
  last_downloaded_at: string | null
  created_at: string
}
```

- [ ] **Step 2: Write migration for atomic increment RPC**

```sql
-- supabase/migrations/00073_increment_download_count_fn.sql
-- Atomic "consume one download" guarded by max_downloads + expiry.
-- Returns the updated row or NULL if policy denies.

CREATE OR REPLACE FUNCTION consume_shop_download(download_id uuid)
RETURNS shop_order_downloads
LANGUAGE plpgsql
AS $$
DECLARE
  updated shop_order_downloads;
BEGIN
  UPDATE shop_order_downloads
     SET download_count = download_count + 1,
         last_downloaded_at = now()
   WHERE id = download_id
     AND (access_expires_at IS NULL OR access_expires_at > now())
     AND (max_downloads IS NULL OR download_count < max_downloads)
   RETURNING * INTO updated;
  RETURN updated;
END;
$$;
```

Apply: `npx supabase db reset`

- [ ] **Step 3: Write failing test**

```ts
// __tests__/lib/db/shop-order-downloads.test.ts
import { describe, expect, it, beforeAll } from "vitest"
import {
  createOrderDownload,
  consumeDownload,
  listDownloadsForOrder,
  revokeDownload,
  extendDownloadAccess,
} from "@/lib/db/shop-order-downloads"
import { createServiceRoleClient } from "@/lib/supabase"

async function seed() {
  const supabase = createServiceRoleClient()
  const { data: product } = await supabase
    .from("shop_products")
    .insert({
      slug: `ds-${Date.now()}`,
      name: "d",
      description: "",
      thumbnail_url: "https://x/i.jpg",
      product_type: "digital",
    })
    .select("id").single()
  const { data: file } = await supabase
    .from("shop_product_files")
    .insert({
      product_id: product!.id,
      file_name: "a.pdf",
      display_name: "a",
      storage_path: "p/a.pdf",
      file_size_bytes: 1,
      mime_type: "application/pdf",
    })
    .select("id").single()
  const { data: order } = await supabase
    .from("shop_orders")
    .insert({
      order_number: "T-" + Date.now(),
      customer_email: "x@x.com",
      customer_name: "x",
      shipping_address: {},
      status: "paid",
      items: [],
      subtotal_cents: 0,
      shipping_cents: 0,
      total_cents: 0,
    })
    .select("id").single()
  return { productId: product!.id, fileId: file!.id, orderId: order!.id }
}

describe("shop-order-downloads DAL", () => {
  it("creates then lists a download", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId,
      product_id: productId,
      file_id: fileId,
      access_expires_at: null,
      max_downloads: null,
    })
    const list = await listDownloadsForOrder(orderId)
    expect(list.find((x) => x.id === d.id)?.download_count).toBe(0)
  })

  it("consumeDownload increments count and returns row", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId, product_id: productId, file_id: fileId,
      access_expires_at: null, max_downloads: 2,
    })
    const first = await consumeDownload(d.id)
    expect(first?.download_count).toBe(1)
    const second = await consumeDownload(d.id)
    expect(second?.download_count).toBe(2)
    const third = await consumeDownload(d.id)
    expect(third).toBeNull() // over cap
  })

  it("consumeDownload returns null when expired", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId, product_id: productId, file_id: fileId,
      access_expires_at: new Date(Date.now() - 1000).toISOString(),
      max_downloads: null,
    })
    expect(await consumeDownload(d.id)).toBeNull()
  })

  it("revokeDownload sets access_expires_at to now", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId, product_id: productId, file_id: fileId,
      access_expires_at: null, max_downloads: null,
    })
    await revokeDownload(d.id)
    expect(await consumeDownload(d.id)).toBeNull()
  })

  it("extendDownloadAccess pushes expiry forward", async () => {
    const { productId, fileId, orderId } = await seed()
    const d = await createOrderDownload({
      order_id: orderId, product_id: productId, file_id: fileId,
      access_expires_at: new Date(Date.now() - 1000).toISOString(),
      max_downloads: null,
    })
    const future = new Date(Date.now() + 60_000).toISOString()
    await extendDownloadAccess(d.id, future)
    expect(await consumeDownload(d.id)).not.toBeNull()
  })
})
```

- [ ] **Step 4: Run — expect FAIL**

- [ ] **Step 5: Implement DAL**

```ts
// lib/db/shop-order-downloads.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopOrderDownload } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createOrderDownload(input: {
  order_id: string
  product_id: string
  file_id: string
  access_expires_at: string | null
  max_downloads: number | null
}): Promise<ShopOrderDownload> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as ShopOrderDownload
}

export async function listDownloadsForOrder(
  orderId: string,
): Promise<ShopOrderDownload[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return data as ShopOrderDownload[]
}

export async function getOrderDownload(
  id: string,
): Promise<ShopOrderDownload | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_order_downloads")
    .select("*")
    .eq("id", id)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopOrderDownload
}

/** Atomically consume one download. Returns the row after increment, or null
 *  if the access window has expired or the max-download cap was reached. */
export async function consumeDownload(
  downloadId: string,
): Promise<ShopOrderDownload | null> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("consume_shop_download", {
    download_id: downloadId,
  })
  if (error) throw error
  if (!data) return null
  // supabase returns the row as an object (single-row RPC)
  return data as ShopOrderDownload
}

export async function revokeDownload(id: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function revokeAllDownloadsForOrder(orderId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: new Date().toISOString() })
    .eq("order_id", orderId)
  if (error) throw error
}

export async function extendDownloadAccess(id: string, newExpiresAtIso: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ access_expires_at: newExpiresAtIso })
    .eq("id", id)
  if (error) throw error
}

export async function bumpMaxDownloads(id: string, newMax: number | null) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_order_downloads")
    .update({ max_downloads: newMax })
    .eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add lib/db/shop-order-downloads.ts types/database.ts supabase/migrations/00073_increment_download_count_fn.sql __tests__/lib/db/shop-order-downloads.test.ts
git commit -m "feat(shop): add shop-order-downloads DAL with atomic consume RPC"
```

---

### Task 25: DAL — shop-leads

**Files:**
- Create: `lib/db/shop-leads.ts`
- Test: `__tests__/lib/db/shop-leads.test.ts`

- [ ] **Step 1: Add interface to types/database.ts**

```ts
export type ResendSyncStatus = "pending" | "synced" | "failed"

export interface ShopLead {
  id: string
  product_id: string
  email: string
  resend_contact_id: string | null
  resend_sync_status: ResendSyncStatus
  resend_sync_error: string | null
  ip_address: string | null
  created_at: string
}
```

- [ ] **Step 2: Write failing test**

```ts
// __tests__/lib/db/shop-leads.test.ts
import { describe, expect, it, beforeAll } from "vitest"
import {
  upsertLead,
  markLeadSynced,
  markLeadFailed,
  listLeads,
  countLeadsForProduct,
} from "@/lib/db/shop-leads"
import { createServiceRoleClient } from "@/lib/supabase"

describe("shop-leads DAL", () => {
  let productId: string
  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `lead-${Date.now()}`,
        name: "lead-test",
        description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
        digital_is_free: true,
      })
      .select("id").single()
    productId = data!.id
  })

  it("upserts a lead and re-upserts without duplicating", async () => {
    const email = `u-${Date.now()}@x.com`
    const a = await upsertLead({ product_id: productId, email, ip_address: "1.1.1.1" })
    const b = await upsertLead({ product_id: productId, email, ip_address: "2.2.2.2" })
    expect(a.id).toBe(b.id) // same row
    expect(await countLeadsForProduct(productId)).toBeGreaterThanOrEqual(1)
  })

  it("markLeadSynced updates status", async () => {
    const email = `sync-${Date.now()}@x.com`
    const lead = await upsertLead({ product_id: productId, email })
    await markLeadSynced(lead.id, "contact_abc")
    const list = await listLeads({})
    const found = list.find((l) => l.id === lead.id)
    expect(found?.resend_sync_status).toBe("synced")
    expect(found?.resend_contact_id).toBe("contact_abc")
  })

  it("markLeadFailed stores error", async () => {
    const email = `fail-${Date.now()}@x.com`
    const lead = await upsertLead({ product_id: productId, email })
    await markLeadFailed(lead.id, "network timeout")
    const list = await listLeads({})
    expect(list.find((l) => l.id === lead.id)?.resend_sync_error).toBe("network timeout")
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement DAL**

```ts
// lib/db/shop-leads.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ShopLead } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function upsertLead(input: {
  product_id: string
  email: string
  ip_address?: string | null
}): Promise<ShopLead> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_leads")
    .upsert(
      {
        product_id: input.product_id,
        email: input.email.toLowerCase(),
        ip_address: input.ip_address ?? null,
      },
      { onConflict: "product_id,email", ignoreDuplicates: false },
    )
    .select()
    .single()
  if (error) throw error
  return data as ShopLead
}

export async function markLeadSynced(id: string, resendContactId: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_leads")
    .update({
      resend_sync_status: "synced",
      resend_contact_id: resendContactId,
      resend_sync_error: null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function markLeadFailed(id: string, errorMessage: string) {
  const supabase = getClient()
  const { error } = await supabase
    .from("shop_leads")
    .update({
      resend_sync_status: "failed",
      resend_sync_error: errorMessage.slice(0, 1000),
    })
    .eq("id", id)
  if (error) throw error
}

export async function listLeads(filter: {
  productId?: string
  status?: "pending" | "synced" | "failed"
  sinceIso?: string
  untilIso?: string
  limit?: number
}): Promise<ShopLead[]> {
  const supabase = getClient()
  let q = supabase.from("shop_leads").select("*").order("created_at", { ascending: false })
  if (filter.productId) q = q.eq("product_id", filter.productId)
  if (filter.status) q = q.eq("resend_sync_status", filter.status)
  if (filter.sinceIso) q = q.gte("created_at", filter.sinceIso)
  if (filter.untilIso) q = q.lte("created_at", filter.untilIso)
  if (filter.limit) q = q.limit(filter.limit)
  const { data, error } = await q
  if (error) throw error
  return data as ShopLead[]
}

export async function countLeadsForProduct(productId: string): Promise<number> {
  const supabase = getClient()
  const { count, error } = await supabase
    .from("shop_leads")
    .select("id", { head: true, count: "exact" })
    .eq("product_id", productId)
  if (error) throw error
  return count ?? 0
}

export async function getLead(id: string): Promise<ShopLead | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_leads").select("*").eq("id", id).single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopLead
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add lib/db/shop-leads.ts types/database.ts __tests__/lib/db/shop-leads.test.ts
git commit -m "feat(shop): add shop-leads DAL"
```

---

### Task 26: lib/shop/downloads.ts — signed URLs + access policy

**Files:**
- Create: `lib/shop/downloads.ts`
- Test: `__tests__/lib/shop/downloads.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/shop/downloads.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { generateSignedDownloadUrl } from "@/lib/shop/downloads"

vi.mock("@/lib/firebase-admin", () => ({
  getPrivateBucket: () => ({
    file: (p: string) => ({
      getSignedUrl: vi.fn().mockResolvedValue([`https://signed.example/${p}?exp=1`]),
    }),
  }),
}))

describe("generateSignedDownloadUrl", () => {
  afterEach(() => vi.clearAllMocks())

  it("returns the signed URL from Firebase Admin", async () => {
    const url = await generateSignedDownloadUrl("downloads/x.pdf", 900)
    expect(url).toContain("signed.example")
    expect(url).toContain("x.pdf")
  })
})
```

- [ ] **Step 2: Run — expect FAIL (file + firebase-admin module missing)**

- [ ] **Step 3: Create firebase admin helper** (if not existing)

Check if `lib/firebase-admin.ts` exists; if not, create:

```ts
// lib/firebase-admin.ts
import { initializeApp, cert, getApps, App } from "firebase-admin/app"
import { getStorage } from "firebase-admin/storage"

function getApp(): App {
  if (getApps().length) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    }),
  })
}

export function getPrivateBucket() {
  const bucketName = process.env.FIREBASE_PRIVATE_BUCKET
  if (!bucketName) throw new Error("FIREBASE_PRIVATE_BUCKET not set")
  return getStorage(getApp()).bucket(bucketName)
}
```

(If a similar helper exists already for the public bucket, reuse it and only add `getPrivateBucket`.)

- [ ] **Step 4: Implement downloads lib**

```ts
// lib/shop/downloads.ts
import { getPrivateBucket } from "@/lib/firebase-admin"

export async function generateSignedDownloadUrl(
  storagePath: string,
  ttlSeconds: number,
): Promise<string> {
  const bucket = getPrivateBucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + ttlSeconds * 1000,
  })
  return url
}

export async function generateSignedUploadUrl(
  storagePath: string,
  contentType: string,
  ttlSeconds: number = 600,
): Promise<string> {
  const bucket = getPrivateBucket()
  const [url] = await bucket.file(storagePath).getSignedUrl({
    action: "write",
    expires: Date.now() + ttlSeconds * 1000,
    contentType,
  })
  return url
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add lib/shop/downloads.ts lib/firebase-admin.ts __tests__/lib/shop/downloads.test.ts
git commit -m "feat(shop): add signed-URL helpers backed by private firebase bucket"
```

---

### Task 27: lib/shop/resend-audience.ts

**Files:**
- Create: `lib/shop/resend-audience.ts`
- Test: `__tests__/lib/shop/resend-audience.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/shop/resend-audience.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { addContactToAudience } from "@/lib/shop/resend-audience"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe("addContactToAudience", () => {
  afterEach(() => mockFetch.mockReset())

  it("POSTs to /audiences/:id/contacts with tag in unsubscribed=false contact payload", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_AUDIENCE_ID = "aud_1"
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "contact_abc" }), { status: 200 }),
    )
    const id = await addContactToAudience({
      email: "user@example.com",
      firstName: null,
      lastName: null,
      tag: "lead-magnet:comeback-code",
    })
    expect(id).toBe("contact_abc")
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toContain("/audiences/aud_1/contacts")
    expect(init.headers.Authorization).toBe("Bearer re_test")
    const body = JSON.parse(init.body)
    expect(body.email).toBe("user@example.com")
    expect(body.unsubscribed).toBe(false)
  })

  it("throws on non-2xx", async () => {
    process.env.RESEND_API_KEY = "re_test"
    process.env.RESEND_AUDIENCE_ID = "aud_1"
    mockFetch.mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    )
    await expect(
      addContactToAudience({ email: "u@x.com", firstName: null, lastName: null, tag: "t" }),
    ).rejects.toThrow(/resend/i)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// lib/shop/resend-audience.ts
export async function addContactToAudience(input: {
  email: string
  firstName: string | null
  lastName: string | null
  tag: string
}): Promise<string> {
  const key = process.env.RESEND_API_KEY
  const audienceId = process.env.RESEND_AUDIENCE_ID
  if (!key) throw new Error("RESEND_API_KEY not set")
  if (!audienceId) throw new Error("RESEND_AUDIENCE_ID not set")

  const res = await fetch(
    `https://api.resend.com/audiences/${audienceId}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        first_name: input.firstName ?? undefined,
        last_name: input.lastName ?? undefined,
        unsubscribed: false,
      }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`resend audience add failed (${res.status}): ${text}`)
  }
  const body = (await res.json()) as { id: string }
  // NOTE: Resend audiences don't support per-contact tags in the v1 API yet;
  // the "tag" arg is recorded on the shop_leads row (sync metadata) rather
  // than on the Resend contact. Kept in the interface for future-compat.
  void input.tag
  return body.id
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add lib/shop/resend-audience.ts __tests__/lib/shop/resend-audience.test.ts
git commit -m "feat(shop): add Resend audience contact helper"
```

---

### Task 28: DAL helper — createDigitalProduct (auto-variant)

**Files:**
- Modify: `lib/db/shop-products.ts`
- Test: `__tests__/lib/db/shop-products-digital.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/lib/db/shop-products-digital.test.ts
import { describe, expect, it } from "vitest"
import { createDigitalProduct, getProductById } from "@/lib/db/shop-products"
import { listVariantsForProduct } from "@/lib/db/shop-variants"

describe("createDigitalProduct", () => {
  it("creates product + single variant for paid", async () => {
    const product = await createDigitalProduct({
      name: "Paid Digital " + Date.now(),
      slug: "paid-digi-" + Date.now(),
      description: "<p>test</p>",
      thumbnail_url: "https://x/i.jpg",
      digital_is_free: false,
      retail_price_cents: 4900,
      digital_signed_url_ttl_seconds: 900,
      digital_access_days: 90,
      digital_max_downloads: 10,
    })
    expect(product.product_type).toBe("digital")
    expect(product.digital_is_free).toBe(false)
    const variants = await listVariantsForProduct(product.id)
    expect(variants.length).toBe(1)
    expect(variants[0].retail_price_cents).toBe(4900)
  })

  it("creates product WITHOUT variant for free", async () => {
    const product = await createDigitalProduct({
      name: "Free Digital " + Date.now(),
      slug: "free-digi-" + Date.now(),
      description: "",
      thumbnail_url: "https://x/i.jpg",
      digital_is_free: true,
      digital_signed_url_ttl_seconds: 900,
    })
    expect(product.digital_is_free).toBe(true)
    const variants = await listVariantsForProduct(product.id)
    expect(variants.length).toBe(0) // free has no cart → no variant needed
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Append to `lib/db/shop-products.ts`**

```ts
import { createDefaultVariant } from "@/lib/db/shop-variants"

export async function createDigitalProduct(input: {
  name: string
  slug: string
  description: string
  thumbnail_url?: string
  digital_is_free: boolean
  retail_price_cents?: number
  digital_access_days?: number | null
  digital_signed_url_ttl_seconds: number
  digital_max_downloads?: number | null
}): Promise<ShopProduct> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_products")
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description,
      thumbnail_url: input.thumbnail_url ?? "",
      product_type: "digital",
      digital_is_free: input.digital_is_free,
      digital_access_days: input.digital_access_days ?? null,
      digital_signed_url_ttl_seconds: input.digital_signed_url_ttl_seconds,
      digital_max_downloads: input.digital_max_downloads ?? null,
      is_active: false,
      is_featured: false,
      sort_order: 0,
    })
    .select()
    .single()
  if (error) throw error
  const product = data as ShopProduct

  if (!input.digital_is_free) {
    if (!input.retail_price_cents || input.retail_price_cents <= 0) {
      throw new Error("paid digital product requires retail_price_cents")
    }
    await createDefaultVariant({
      product_id: product.id,
      retail_price_cents: input.retail_price_cents,
      thumbnail_url: product.thumbnail_url,
    })
  }
  return product
}
```

- [ ] **Step 4: Add `createDefaultVariant` to `lib/db/shop-variants.ts`**

Append:

```ts
export async function createDefaultVariant(input: {
  product_id: string
  retail_price_cents: number
  thumbnail_url: string
}) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_product_variants")
    .insert({
      product_id: input.product_id,
      printful_sync_variant_id: null,
      printful_variant_id: null,
      sku: `digital-${input.product_id.slice(0, 8)}`,
      name: "Default",
      size: null,
      color: null,
      retail_price_cents: input.retail_price_cents,
      printful_cost_cents: 0,
      mockup_url: input.thumbnail_url,
      mockup_urls: [],
      is_available: true,
    })
    .select()
    .single()
  if (error) throw error
  return data
}
```

**Note:** `shop_product_variants.printful_sync_variant_id` must be nullable. If the existing migration has it NOT NULL + UNIQUE, add a migration:

```sql
-- supabase/migrations/00074_shop_variants_nullable_printful.sql
ALTER TABLE shop_product_variants
  ALTER COLUMN printful_sync_variant_id DROP NOT NULL,
  ALTER COLUMN printful_variant_id DROP NOT NULL;
-- The UNIQUE index on printful_sync_variant_id still works (NULLs are distinct).
```

- [ ] **Step 5: Apply migration + run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add lib/db/shop-products.ts lib/db/shop-variants.ts supabase/migrations/00074_shop_variants_nullable_printful.sql __tests__/lib/db/shop-products-digital.test.ts
git commit -m "feat(shop): add createDigitalProduct with auto-variant for paid products"
```

---

### Task 29: API — /api/uploads/shop-pdf signed-upload

**Files:**
- Create: `app/api/uploads/shop-pdf/route.ts`
- Test: `__tests__/api/uploads/shop-pdf.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/uploads/shop-pdf.test.ts
import { describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/uploads/shop-pdf/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))
vi.mock("@/lib/shop/downloads", () => ({
  generateSignedUploadUrl: vi.fn().mockResolvedValue("https://signed-upload.example/pdf?exp=1"),
}))

describe("POST /api/uploads/shop-pdf", () => {
  it("returns signed upload URL + storage path", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "workbook.pdf",
        content_type: "application/pdf",
        file_size_bytes: 500000,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.upload_url).toContain("signed-upload.example")
    expect(body.storage_path).toMatch(/^shop-downloads\/.*workbook\.pdf$/)
  })

  it("rejects oversize file", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "big.pdf",
        content_type: "application/pdf",
        file_size_bytes: 600 * 1024 * 1024,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("rejects bad mime", async () => {
    const req = new Request("http://x/api/uploads/shop-pdf", {
      method: "POST",
      body: JSON.stringify({
        file_name: "x.exe",
        content_type: "application/x-msdownload",
        file_size_bytes: 1000,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route**

```ts
// app/api/uploads/shop-pdf/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { generateSignedUploadUrl } from "@/lib/shop/downloads"
import { z } from "zod"
import crypto from "node:crypto"

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
])
const MAX_BYTES = 500 * 1024 * 1024 // 500 MB

const bodySchema = z.object({
  file_name: z.string().min(1).max(200),
  content_type: z.string().min(1),
  file_size_bytes: z.number().int().positive(),
})

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const v = parsed.data
  if (!ALLOWED_MIMES.has(v.content_type)) {
    return NextResponse.json({ error: "unsupported mime type" }, { status: 400 })
  }
  if (v.file_size_bytes > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 500MB" }, { status: 400 })
  }
  const safeName = v.file_name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const prefix = crypto.randomUUID()
  const storage_path = `shop-downloads/${prefix}/${safeName}`
  const upload_url = await generateSignedUploadUrl(storage_path, v.content_type, 600)
  return NextResponse.json({ upload_url, storage_path })
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/api/uploads/shop-pdf __tests__/api/uploads/shop-pdf.test.ts
git commit -m "feat(shop): add admin-only signed upload endpoint for PDF files"
```

---

### Task 30: API — /api/shop/leads (free PDF capture)

**Files:**
- Create: `app/api/shop/leads/route.ts`
- Create: `lib/shop/emails.ts` helper `sendFreeDownloadEmail` (if not existing file, create)
- Test: `__tests__/api/shop/leads.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/shop/leads.test.ts
import { describe, expect, it, vi, beforeAll } from "vitest"
import { POST } from "@/app/api/shop/leads/route"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/shop/resend-audience", () => ({
  addContactToAudience: vi.fn().mockResolvedValue("contact_mock"),
}))
vi.mock("@/lib/shop/emails", async () => {
  const actual = await vi.importActual<object>("@/lib/shop/emails")
  return { ...actual, sendFreeDownloadEmail: vi.fn().mockResolvedValue(undefined) }
})

describe("POST /api/shop/leads", () => {
  let productId: string
  beforeAll(async () => {
    const supabase = createServiceRoleClient()
    const { data } = await supabase
      .from("shop_products")
      .insert({
        slug: `lead-api-${Date.now()}`,
        name: "x", description: "",
        thumbnail_url: "https://x/i.jpg",
        product_type: "digital",
        digital_is_free: true,
        is_active: true,
      }).select("id").single()
    productId = data!.id
    await supabase.from("shop_product_files").insert({
      product_id: productId, file_name: "x.pdf", display_name: "X",
      storage_path: "shop-downloads/x/x.pdf", file_size_bytes: 100,
      mime_type: "application/pdf",
    })
  })

  it("creates lead + calls Resend + sends email", async () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    const req = new Request("http://x/api/shop/leads", {
      method: "POST",
      body: JSON.stringify({
        email: `u-${Date.now()}@x.com`,
        product_id: productId,
        website: "",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it("rejects honeypot", async () => {
    process.env.SHOP_DIGITAL_ENABLED = "true"
    const req = new Request("http://x/api/shop/leads", {
      method: "POST",
      body: JSON.stringify({
        email: "u@x.com", product_id: productId, website: "spam",
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add / extend `lib/shop/emails.ts`**

If `lib/shop/emails.ts` does not have `sendFreeDownloadEmail`, append:

```ts
// in lib/shop/emails.ts
import { generateSignedDownloadUrl } from "@/lib/shop/downloads"
import type { ShopProductFile } from "@/types/database"
import { getResendClient } from "@/lib/resend" // existing helper — adjust path if different

export async function sendFreeDownloadEmail(input: {
  to: string
  productName: string
  files: ShopProductFile[]
  ttlSeconds: number
}) {
  const urls = await Promise.all(
    input.files.map(async (f) => ({
      name: f.display_name,
      url: await generateSignedDownloadUrl(f.storage_path, input.ttlSeconds),
    })),
  )
  const html = `
    <h1>Your free download</h1>
    <p>Thanks for subscribing. Here's your download for <strong>${input.productName}</strong>:</p>
    <ul>
      ${urls.map((u) => `<li><a href="${u.url}">${u.name}</a></li>`).join("")}
    </ul>
    <p>Links expire in ${Math.round(input.ttlSeconds / 60)} minutes. Re-submit the form on the product page if you need fresh links.</p>
  `
  const resend = getResendClient()
  await resend.emails.send({
    from: "DJP Athlete <shop@djpathlete.com>",
    to: input.to,
    subject: `Your free download — ${input.productName}`,
    html,
  })
}
```

(If `getResendClient()` does not exist, adapt to however the project's Resend client is accessed.)

- [ ] **Step 4: Implement the route**

```ts
// app/api/shop/leads/route.ts
import { NextResponse } from "next/server"
import { leadFormSchema } from "@/lib/validators/shop-phase2"
import { getProductById } from "@/lib/db/shop-products"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import {
  upsertLead,
  markLeadSynced,
  markLeadFailed,
} from "@/lib/db/shop-leads"
import { addContactToAudience } from "@/lib/shop/resend-audience"
import { sendFreeDownloadEmail } from "@/lib/shop/emails"
import { isShopDigitalEnabled } from "@/lib/shop/feature-flag"
import { rateLimit } from "@/lib/rate-limit" // existing helper — adjust if not present

export async function POST(req: Request) {
  if (!isShopDigitalEnabled()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 })
  }
  const ip = req.headers.get("x-forwarded-for") ?? "unknown"
  const allowed = await rateLimit(`shop-leads:${ip}`, 3, 60) // 3/min
  if (!allowed) {
    return NextResponse.json({ error: "rate limit" }, { status: 429 })
  }

  const parsed = leadFormSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { email, product_id } = parsed.data

  const product = await getProductById(product_id)
  if (!product || product.product_type !== "digital" || !product.digital_is_free) {
    return NextResponse.json({ error: "not a free digital product" }, { status: 404 })
  }

  const files = await listFilesForProduct(product.id)
  if (files.length === 0) {
    return NextResponse.json({ error: "product has no files" }, { status: 409 })
  }

  const lead = await upsertLead({ product_id, email, ip_address: ip })

  // Send download email FIRST (primary promise to user). Resend sync is secondary.
  try {
    await sendFreeDownloadEmail({
      to: email,
      productName: product.name,
      files,
      ttlSeconds: product.digital_signed_url_ttl_seconds,
    })
  } catch (e) {
    console.error("free-download email failed", e)
    return NextResponse.json({ error: "email failed" }, { status: 502 })
  }

  // Audience sync — best-effort; failures don't block customer.
  try {
    const contactId = await addContactToAudience({
      email,
      firstName: null,
      lastName: null,
      tag: `lead-magnet:${product.slug}`,
    })
    await markLeadSynced(lead.id, contactId)
  } catch (e: unknown) {
    await markLeadFailed(lead.id, String((e as Error).message ?? e))
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add app/api/shop/leads lib/shop/emails.ts __tests__/api/shop/leads.test.ts
git commit -m "feat(shop): add free-PDF lead-capture endpoint with Resend sync"
```

---

### Task 31: API — /api/shop/downloads/sign

**Files:**
- Create: `app/api/shop/downloads/sign/route.ts`
- Test: `__tests__/api/shop/downloads-sign.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/shop/downloads-sign.test.ts
import { describe, expect, it, vi, beforeAll } from "vitest"
import { POST } from "@/app/api/shop/downloads/sign/route"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/shop/downloads", () => ({
  generateSignedDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
}))

async function seedFullOrderWithDownload() {
  const supabase = createServiceRoleClient()
  const { data: product } = await supabase
    .from("shop_products").insert({
      slug: "sg-" + Date.now(), name: "x", description: "",
      thumbnail_url: "https://x/i.jpg", product_type: "digital",
    }).select("id").single()
  const { data: file } = await supabase
    .from("shop_product_files").insert({
      product_id: product!.id, file_name: "a.pdf",
      display_name: "a", storage_path: "p/a.pdf",
      file_size_bytes: 1, mime_type: "application/pdf",
    }).select("id").single()
  const { data: order } = await supabase
    .from("shop_orders").insert({
      order_number: "T-" + Date.now(), customer_email: "u@x.com",
      customer_name: "x", shipping_address: {}, status: "fulfilled_digital",
      items: [], subtotal_cents: 0, shipping_cents: 0, total_cents: 0,
    }).select("id, order_number, customer_email").single()
  const { data: download } = await supabase
    .from("shop_order_downloads").insert({
      order_id: order!.id, product_id: product!.id, file_id: file!.id,
      access_expires_at: null, max_downloads: null,
    }).select("id").single()
  return { order, downloadId: download!.id }
}

describe("POST /api/shop/downloads/sign", () => {
  it("returns signed URL on valid email match", async () => {
    const { order, downloadId } = await seedFullOrderWithDownload()
    const req = new Request("http://x/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({
        order_number: order!.order_number,
        email: order!.customer_email,
        download_id: downloadId,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain("signed.example")
  })

  it("rejects mismatched email", async () => {
    const { order, downloadId } = await seedFullOrderWithDownload()
    const req = new Request("http://x/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({
        order_number: order!.order_number,
        email: "wrong@x.com",
        download_id: downloadId,
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route**

```ts
// app/api/shop/downloads/sign/route.ts
import { NextResponse } from "next/server"
import { downloadSignRequestSchema } from "@/lib/validators/shop-phase2"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import {
  getOrderDownload,
  consumeDownload,
} from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { getProductById } from "@/lib/db/shop-products"
import { generateSignedDownloadUrl } from "@/lib/shop/downloads"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown"
  const allowed = await rateLimit(`shop-dl:${ip}`, 20, 60)
  if (!allowed) return NextResponse.json({ error: "rate limit" }, { status: 429 })

  const parsed = downloadSignRequestSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { order_number, email, download_id } = parsed.data

  const order = await getOrderByNumber(order_number)
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (order.customer_email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "email mismatch" }, { status: 403 })
  }

  const download = await getOrderDownload(download_id)
  if (!download || download.order_id !== order.id) {
    return NextResponse.json({ error: "download not found" }, { status: 404 })
  }

  const file = await getProductFile(download.file_id)
  if (!file) return NextResponse.json({ error: "file missing" }, { status: 404 })

  const product = await getProductById(download.product_id)
  if (!product) return NextResponse.json({ error: "product missing" }, { status: 404 })

  // Atomically enforce expiry + max-downloads.
  const consumed = await consumeDownload(download.id)
  if (!consumed) {
    return NextResponse.json(
      { error: "access expired or download limit reached" },
      { status: 410 },
    )
  }

  const url = await generateSignedDownloadUrl(
    file.storage_path,
    product.digital_signed_url_ttl_seconds,
  )
  return NextResponse.json({ url })
}
```

- [ ] **Step 4: Ensure `getOrderByNumber` exists in `lib/db/shop-orders.ts`**

If it doesn't, add:

```ts
export async function getOrderByNumber(orderNumber: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("shop_orders").select("*").eq("order_number", orderNumber).single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw error
  }
  return data as ShopOrder
}
```

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add app/api/shop/downloads lib/db/shop-orders.ts __tests__/api/shop/downloads-sign.test.ts
git commit -m "feat(shop): add signed-download endpoint with email gate + atomic consume"
```

---

### Task 32: API — /api/admin/shop/leads/export (CSV)

**Files:**
- Create: `app/api/admin/shop/leads/export/route.ts`
- Test: `__tests__/api/admin/shop/leads-export.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/admin/shop/leads-export.test.ts
import { describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/admin/shop/leads/export/route"

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "u1", role: "admin" }),
}))

describe("GET /api/admin/shop/leads/export", () => {
  it("returns CSV with header row", async () => {
    const req = new Request("http://x/api/admin/shop/leads/export")
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    const text = await res.text()
    expect(text.split("\n")[0]).toBe("email,product_id,resend_sync_status,created_at")
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement route**

```ts
// app/api/admin/shop/leads/export/route.ts
import { requireAdmin } from "@/lib/auth-helpers"
import { listLeads } from "@/lib/db/shop-leads"

export async function GET(req: Request) {
  await requireAdmin()
  const url = new URL(req.url)
  const productId = url.searchParams.get("product_id") ?? undefined
  const status = url.searchParams.get("status") as
    | "pending" | "synced" | "failed" | null
  const leads = await listLeads({
    productId,
    status: status ?? undefined,
    limit: 10000,
  })
  const rows = [
    "email,product_id,resend_sync_status,created_at",
    ...leads.map(
      (l) =>
        `${escape(l.email)},${l.product_id},${l.resend_sync_status},${l.created_at}`,
    ),
  ].join("\n")
  return new Response(rows, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="shop-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function escape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replaceAll('"', '""')}"`
  }
  return v
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/shop/leads __tests__/api/admin/shop/leads-export.test.ts
git commit -m "feat(admin-shop): add CSV export for leads"
```

---

### Task 33: API — /api/admin/shop/downloads/[id]/revoke + extend + bump-max

**Files:**
- Create: `app/api/admin/shop/downloads/[id]/revoke/route.ts`
- Create: `app/api/admin/shop/downloads/[id]/extend/route.ts`
- Create: `app/api/admin/shop/downloads/[id]/max/route.ts`

- [ ] **Step 1: Implement revoke**

```ts
// app/api/admin/shop/downloads/[id]/revoke/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { revokeDownload } from "@/lib/db/shop-order-downloads"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  await revokeDownload(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Implement extend**

```ts
// app/api/admin/shop/downloads/[id]/extend/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { extendDownloadAccess } from "@/lib/db/shop-order-downloads"
import { z } from "zod"

const body = z.object({ expires_at: z.string().datetime() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const parsed = body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  await extendDownloadAccess(id, parsed.data.expires_at)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Implement max bump**

```ts
// app/api/admin/shop/downloads/[id]/max/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { bumpMaxDownloads } from "@/lib/db/shop-order-downloads"
import { z } from "zod"

const body = z.object({ max: z.number().int().positive().nullable() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const parsed = body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  await bumpMaxDownloads(id, parsed.data.max)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Smoke test in dev, then commit**

```bash
git add app/api/admin/shop/downloads
git commit -m "feat(admin-shop): add download revoke/extend/max admin actions"
```

---

### Task 34: Extend /api/shop/quote — skip shipping on non-POD lines

**Files:**
- Modify: `app/api/shop/quote/route.ts`
- Test: extend `__tests__/api/shop/quote.test.ts` (or create new)

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/shop/quote-mixed.test.ts
import { describe, expect, it, vi, beforeAll } from "vitest"
import { POST } from "@/app/api/shop/quote/route"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/printful", () => ({
  getShippingRates: vi.fn().mockResolvedValue([{ rate: "9.99", currency: "USD" }]),
}))

async function seedMixed() {
  const supabase = createServiceRoleClient()
  const { data: podProduct } = await supabase.from("shop_products").insert({
    slug: "pod-" + Date.now(), name: "p", description: "",
    thumbnail_url: "https://x/i.jpg", product_type: "pod",
    printful_sync_id: Date.now(), is_active: true,
  }).select("id").single()
  const { data: podVariant } = await supabase.from("shop_product_variants").insert({
    product_id: podProduct!.id, printful_sync_variant_id: Date.now(),
    printful_variant_id: 1001, sku: "sku", name: "Default",
    retail_price_cents: 2000, printful_cost_cents: 1000,
    mockup_url: "https://x/m.jpg", mockup_urls: [], is_available: true,
  }).select("id, printful_variant_id").single()
  const { data: digProduct } = await supabase.from("shop_products").insert({
    slug: "dig-" + Date.now(), name: "d", description: "",
    thumbnail_url: "https://x/i.jpg", product_type: "digital",
    digital_signed_url_ttl_seconds: 900, is_active: true,
  }).select("id").single()
  const { data: digVariant } = await supabase.from("shop_product_variants").insert({
    product_id: digProduct!.id, sku: "d", name: "Default",
    retail_price_cents: 4900, printful_cost_cents: 0,
    mockup_url: "https://x/m.jpg", mockup_urls: [], is_available: true,
  }).select("id").single()
  return { podVariantId: podVariant!.id, digVariantId: digVariant!.id }
}

describe("POST /api/shop/quote (mixed cart)", () => {
  it("quotes shipping only for POD lines", async () => {
    const { podVariantId, digVariantId } = await seedMixed()
    const req = new Request("http://x/api/shop/quote", {
      method: "POST",
      body: JSON.stringify({
        items: [
          { variant_id: podVariantId, quantity: 1 },
          { variant_id: digVariantId, quantity: 1 },
        ],
        address: { country: "US", state: "CA", postal_code: "94102", city: "SF", line1: "1 Main St" },
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    // Printful was called with only the POD variant; digital contributes 0 shipping.
    expect(body.shipping_cents).toBe(999)
  })

  it("returns 0 shipping for digital-only cart without hitting Printful", async () => {
    const { digVariantId } = await seedMixed()
    const { getShippingRates } = await import("@/lib/printful")
    vi.mocked(getShippingRates).mockClear()
    const req = new Request("http://x/api/shop/quote", {
      method: "POST",
      body: JSON.stringify({
        items: [{ variant_id: digVariantId, quantity: 1 }],
        address: { country: "US", state: "CA", postal_code: "94102", city: "SF", line1: "1 Main St" },
      }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(body.shipping_cents).toBe(0)
    expect(vi.mocked(getShippingRates)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Modify route to branch by product_type**

In `app/api/shop/quote/route.ts`, after resolving variants, partition by their parent product:

```ts
// Pseudocode outline — adapt to the route's existing structure.
const variantsWithProduct = await Promise.all(
  items.map(async (i) => {
    const variant = await getVariantById(i.variant_id)
    if (!variant) throw new Error("variant missing")
    const product = await getProductById(variant.product_id)
    if (!product) throw new Error("product missing")
    if (product.product_type === "affiliate") {
      throw new Error("affiliate cannot be in cart")
    }
    return { variant, product, quantity: i.quantity }
  }),
)

const podLines = variantsWithProduct.filter((x) => x.product.product_type === "pod")

let shippingCents = 0
if (podLines.length > 0) {
  const rates = await getShippingRates({
    recipient: address,
    items: podLines.map((x) => ({
      variant_id: x.variant.printful_variant_id!,
      quantity: x.quantity,
    })),
  })
  shippingCents = Math.round(Number(rates[0].rate) * 100)
}

const subtotalCents = variantsWithProduct.reduce(
  (s, x) => s + x.variant.retail_price_cents * x.quantity, 0,
)

return NextResponse.json({
  subtotal_cents: subtotalCents,
  shipping_cents: shippingCents,
  total_cents: subtotalCents + shippingCents,
})
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/api/shop/quote __tests__/api/shop/quote-mixed.test.ts
git commit -m "feat(shop): compute shipping only on POD lines; reject affiliate"
```

---

### Task 35: Extend /api/shop/checkout — type metadata + reject affiliate

**Files:**
- Modify: `app/api/shop/checkout/route.ts`

- [ ] **Step 1: Update checkout to tag Stripe line items with type**

Locate the section building Stripe `line_items` and, for each, add metadata identifying the product type. Also re-validate affiliate rejection:

```ts
const lineItems = variantsWithProduct.map((x) => ({
  price_data: {
    currency: "usd",
    product_data: {
      name: `${x.product.name} — ${x.variant.name}`,
      // Carry product_type so the webhook can partition quickly.
      metadata: {
        product_id: x.product.id,
        variant_id: x.variant.id,
        product_type: x.product.product_type, // "pod" or "digital"
      },
    },
    unit_amount: x.variant.retail_price_cents,
  },
  quantity: x.quantity,
}))
```

Also set session-level metadata:

```ts
metadata: {
  type: "shop_order",
  order_id,
  order_number,
  contains_digital: variantsWithProduct.some((x) => x.product.product_type === "digital")
    ? "true"
    : "false",
  contains_pod: variantsWithProduct.some((x) => x.product.product_type === "pod")
    ? "true"
    : "false",
},
```

Keep `shipping_options` only populated when there are POD lines.

- [ ] **Step 2: Rebuild `shop_orders.items` jsonb with `product_type` per line**

Extend `ShopOrderItem` in `types/database.ts`:

```ts
export interface ShopOrderItem {
  variant_id: string
  product_id: string
  product_type: "pod" | "digital"
  name: string
  variant_name: string
  thumbnail_url: string
  quantity: number
  unit_price_cents: number
  printful_variant_id: number | null   // null for digital
}
```

Update checkout to include `product_type` in each persisted `items[]` entry.

- [ ] **Step 3: Write/extend tests and run**

Add a test that submits a mixed cart and asserts the created `shop_orders.items` each carry `product_type`.

- [ ] **Step 4: Commit**

```bash
git add app/api/shop/checkout types/database.ts __tests__/api/shop/checkout.test.ts
git commit -m "feat(shop): carry product_type through checkout and order items"
```

---

### Task 36: Extend Stripe webhook — digital fulfillment + fulfilled_digital status

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Test: `__tests__/api/stripe/webhook-digital.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/api/stripe/webhook-digital.test.ts
// Given a shop_order with digital-only items, simulating checkout.session.completed
// should: create shop_order_downloads rows, set status to 'fulfilled_digital',
// and send the "download ready" email.

import { describe, expect, it, vi, beforeAll } from "vitest"
import { POST } from "@/app/api/stripe/webhook/route"
import { createServiceRoleClient } from "@/lib/supabase"

vi.mock("@/lib/shop/emails", async () => {
  const actual = await vi.importActual<object>("@/lib/shop/emails")
  return {
    ...actual,
    sendDigitalFulfillmentEmail: vi.fn().mockResolvedValue(undefined),
  }
})
// Also mock stripe signature verification to accept our synthetic event.
vi.mock("stripe", () => {
  return {
    default: class {
      webhooks = {
        constructEvent: (body: string) => JSON.parse(body),
      }
    },
  }
})

async function seedPaidDigitalOrder() {
  const supabase = createServiceRoleClient()
  const { data: product } = await supabase.from("shop_products").insert({
    slug: "whd-" + Date.now(), name: "d", description: "",
    thumbnail_url: "https://x/i.jpg", product_type: "digital",
    digital_signed_url_ttl_seconds: 900, is_active: true,
  }).select("id").single()
  const { data: variant } = await supabase.from("shop_product_variants").insert({
    product_id: product!.id, sku: "d", name: "Default",
    retail_price_cents: 4900, printful_cost_cents: 0,
    mockup_url: "https://x/m.jpg", mockup_urls: [], is_available: true,
  }).select("id").single()
  const { data: file } = await supabase.from("shop_product_files").insert({
    product_id: product!.id, file_name: "w.pdf", display_name: "W",
    storage_path: "p/w.pdf", file_size_bytes: 1, mime_type: "application/pdf",
  }).select("id").single()
  const { data: order } = await supabase.from("shop_orders").insert({
    order_number: "W-" + Date.now(), customer_email: "u@x.com",
    customer_name: "u", shipping_address: {},
    stripe_session_id: "cs_test_" + Date.now(),
    status: "pending", subtotal_cents: 4900, shipping_cents: 0, total_cents: 4900,
    items: [{
      variant_id: variant!.id, product_id: product!.id, product_type: "digital",
      name: "d", variant_name: "Default", thumbnail_url: "https://x/m.jpg",
      quantity: 1, unit_price_cents: 4900, printful_variant_id: null,
    }],
  }).select("id, order_number, stripe_session_id").single()
  return { orderId: order!.id, sessionId: order!.stripe_session_id!, fileId: file!.id }
}

describe("stripe webhook — digital-only order", () => {
  it("creates download rows and sets fulfilled_digital", async () => {
    const { orderId, sessionId } = await seedPaidDigitalOrder()
    const event = {
      id: "evt_" + Date.now(),
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          payment_intent: "pi_test",
          metadata: {
            type: "shop_order",
            order_id: orderId,
            contains_digital: "true",
            contains_pod: "false",
          },
        },
      },
    }
    const req = new Request("http://x/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=0,v1=sig" },
      body: JSON.stringify(event),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const supabase = createServiceRoleClient()
    const { data: updated } = await supabase
      .from("shop_orders").select("status").eq("id", orderId).single()
    expect(updated!.status).toBe("fulfilled_digital")
    const { data: downloads } = await supabase
      .from("shop_order_downloads").select("*").eq("order_id", orderId)
    expect(downloads!.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Extend the webhook handler**

In the `checkout.session.completed` branch that matches `metadata.type === "shop_order"`, add a digital-fulfillment step:

```ts
import {
  createOrderDownload,
  listDownloadsForOrder,
} from "@/lib/db/shop-order-downloads"
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { sendDigitalFulfillmentEmail } from "@/lib/shop/emails"

// after resolving `order` and updating it to status='paid' + storing payment_intent:
const digitalItems = order.items.filter((i) => i.product_type === "digital")
if (digitalItems.length > 0) {
  // Idempotency: only create if no downloads yet exist for the order.
  const existing = await listDownloadsForOrder(order.id)
  if (existing.length === 0) {
    for (const item of digitalItems) {
      const product = await getProductById(item.product_id)
      if (!product) continue
      const files = await listFilesForProduct(product.id)
      const expiresAt =
        product.digital_access_days != null
          ? new Date(Date.now() + product.digital_access_days * 86_400_000).toISOString()
          : null
      for (const f of files) {
        await createOrderDownload({
          order_id: order.id,
          product_id: product.id,
          file_id: f.id,
          access_expires_at: expiresAt,
          max_downloads: product.digital_max_downloads ?? null,
        })
      }
    }
    await sendDigitalFulfillmentEmail({
      to: order.customer_email,
      orderNumber: order.order_number,
    })
  }
}

const hasPod = order.items.some((i) => i.product_type === "pod")
const hasDigital = digitalItems.length > 0
if (hasDigital && !hasPod) {
  await updateOrderStatus(order.id, "fulfilled_digital")
} else {
  // mixed: leave at 'paid' — POD side still waits for admin confirm
}
```

Add `sendDigitalFulfillmentEmail` to `lib/shop/emails.ts`:

```ts
export async function sendDigitalFulfillmentEmail(input: {
  to: string
  orderNumber: string
}) {
  const resend = getResendClient()
  await resend.emails.send({
    from: "DJP Athlete <shop@djpathlete.com>",
    to: input.to,
    subject: `Your download is ready — order ${input.orderNumber}`,
    html: `
      <h1>Your download is ready</h1>
      <p>You can access your files any time at:</p>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/shop/orders/${input.orderNumber}/downloads">View downloads</a></p>
    `,
  })
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/webhook lib/shop/emails.ts __tests__/api/stripe/webhook-digital.test.ts
git commit -m "feat(shop): fulfill digital lines on stripe webhook + fulfilled_digital status"
```

---

### Task 37: Admin — new digital product form + file manager

**Files:**
- Create: `app/(admin)/admin/shop/products/new/digital/page.tsx`
- Create: `app/(admin)/admin/shop/products/new/digital/DigitalProductForm.tsx`
- Create: `app/api/admin/shop/products/digital/route.ts`

- [ ] **Step 1: API route**

```ts
// app/api/admin/shop/products/digital/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { digitalProductInputSchema } from "@/lib/validators/shop-phase2"
import { createDigitalProduct } from "@/lib/db/shop-products"

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = digitalProductInputSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const v = parsed.data
  const product = await createDigitalProduct({
    name: v.name,
    slug: v.slug,
    description: v.description,
    thumbnail_url: v.thumbnail_url,
    digital_is_free: v.digital_is_free,
    retail_price_cents: v.retail_price_cents,
    digital_access_days: v.digital_access_days ?? null,
    digital_signed_url_ttl_seconds: v.digital_signed_url_ttl_seconds,
    digital_max_downloads: v.digital_max_downloads ?? null,
  })
  return NextResponse.json({ product })
}
```

- [ ] **Step 2: Client form**

```tsx
// app/(admin)/admin/shop/products/new/digital/DigitalProductForm.tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function DigitalProductForm() {
  const router = useRouter()
  const [isFree, setIsFree] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    const f = new FormData(e.currentTarget)
    const payload = {
      name: String(f.get("name") ?? ""),
      slug: String(f.get("slug") ?? ""),
      description: String(f.get("description") ?? ""),
      thumbnail_url: String(f.get("thumbnail_url") ?? ""),
      digital_is_free: isFree,
      retail_price_cents: isFree
        ? undefined
        : Math.round(Number(f.get("price_dollars") ?? 0) * 100),
      digital_signed_url_ttl_seconds: Number(f.get("ttl_seconds") ?? 900),
      digital_access_days: f.get("access_days") ? Number(f.get("access_days")) : null,
      digital_max_downloads: f.get("max_downloads") ? Number(f.get("max_downloads")) : null,
    }
    const res = await fetch("/api/admin/shop/products/digital", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (!res.ok) { toast.error("Failed"); return }
    const { product } = await res.json()
    toast.success("Digital product created")
    router.push(`/admin/shop/products/${product.id}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block"><span className="text-sm">Name</span>
        <input name="name" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Slug</span>
        <input name="slug" required pattern="[a-z0-9-]+" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Description</span>
        <textarea name="description" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="block"><span className="text-sm">Thumbnail URL</span>
        <input name="thumbnail_url" type="url" className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
        <span>Free lead magnet (no cart, collects email)</span>
      </label>
      {!isFree && (
        <label className="block"><span className="text-sm">Price (USD)</span>
          <input name="price_dollars" type="number" step="0.01" required className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      )}
      <fieldset className="rounded border border-border p-4">
        <legend className="px-2 text-sm">Access settings</legend>
        <label className="block"><span className="text-sm">Signed URL TTL (seconds)</span>
          <select name="ttl_seconds" defaultValue="900" className="mt-1 w-full rounded border px-3 py-2">
            <option value="900">15 minutes</option>
            <option value="3600">1 hour</option>
            <option value="14400">4 hours</option>
            <option value="86400">24 hours</option>
          </select>
        </label>
        <label className="mt-3 block"><span className="text-sm">Access window (days — blank = forever)</span>
          <input name="access_days" type="number" min="1" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
        <label className="mt-3 block"><span className="text-sm">Max downloads per purchase (blank = unlimited)</span>
          <input name="max_downloads" type="number" min="1" className="mt-1 w-full rounded border px-3 py-2" />
        </label>
      </fieldset>
      <button type="submit" disabled={submitting} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
        {submitting ? "Creating…" : "Create"}
      </button>
      <p className="text-xs text-muted-foreground">File uploads happen on the product detail page after creation.</p>
    </form>
  )
}
```

- [ ] **Step 3: Page wrapper**

```tsx
// app/(admin)/admin/shop/products/new/digital/page.tsx
import { DigitalProductForm } from "./DigitalProductForm"

export default function NewDigitalProductPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-heading text-2xl">New digital product</h1>
      <DigitalProductForm />
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/shop/products/new/digital app/api/admin/shop/products/digital
git commit -m "feat(admin-shop): add new-digital-product form and API"
```

---

### Task 38: Admin product detail — digital panels (access + files + stats)

**Files:**
- Modify: `app/(admin)/admin/shop/products/[id]/page.tsx`
- Create: `app/(admin)/admin/shop/products/[id]/DigitalFileManager.tsx`
- Create: `app/api/admin/shop/products/[id]/files/route.ts`
- Create: `app/api/admin/shop/products/[id]/files/[fileId]/route.ts`

- [ ] **Step 1: Attach/delete file routes**

```ts
// app/api/admin/shop/products/[id]/files/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { attachFileToProduct } from "@/lib/db/shop-product-files"
import { z } from "zod"

const body = z.object({
  file_name: z.string().min(1),
  display_name: z.string().min(1),
  storage_path: z.string().min(1),
  file_size_bytes: z.number().int().positive(),
  mime_type: z.string().min(1),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const parsed = body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const file = await attachFileToProduct({ product_id: id, ...parsed.data })
  return NextResponse.json({ file })
}
```

```ts
// app/api/admin/shop/products/[id]/files/[fileId]/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { deleteProductFile, updateProductFile } from "@/lib/db/shop-product-files"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  await requireAdmin()
  const { fileId } = await params
  const body = await req.json()
  await updateProductFile(fileId, {
    display_name: body.display_name,
    sort_order: body.sort_order,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  await requireAdmin()
  const { fileId } = await params
  await deleteProductFile(fileId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: File manager client component**

```tsx
// app/(admin)/admin/shop/products/[id]/DigitalFileManager.tsx
"use client"
import { useState } from "react"
import { toast } from "sonner"
import type { ShopProductFile } from "@/types/database"

export function DigitalFileManager({
  productId,
  initialFiles,
}: {
  productId: string
  initialFiles: ShopProductFile[]
}) {
  const [files, setFiles] = useState(initialFiles)
  const [uploading, setUploading] = useState(false)

  async function onUpload(f: File) {
    setUploading(true)
    try {
      const signRes = await fetch("/api/uploads/shop-pdf", {
        method: "POST",
        body: JSON.stringify({
          file_name: f.name, content_type: f.type, file_size_bytes: f.size,
        }),
      })
      if (!signRes.ok) throw new Error("sign failed")
      const { upload_url, storage_path } = await signRes.json()
      const put = await fetch(upload_url, {
        method: "PUT", body: f, headers: { "Content-Type": f.type },
      })
      if (!put.ok) throw new Error("upload failed")
      const attach = await fetch(`/api/admin/shop/products/${productId}/files`, {
        method: "POST",
        body: JSON.stringify({
          file_name: f.name, display_name: f.name,
          storage_path, file_size_bytes: f.size, mime_type: f.type,
        }),
      })
      const { file } = await attach.json()
      setFiles((prev) => [...prev, file])
      toast.success("Uploaded")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function onDelete(fileId: string) {
    if (!confirm("Delete this file?")) return
    const res = await fetch(
      `/api/admin/shop/products/${productId}/files/${fileId}`,
      { method: "DELETE" },
    )
    if (res.ok) setFiles((p) => p.filter((f) => f.id !== fileId))
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-4">
        <input
          type="file"
          accept="application/pdf,application/zip,video/mp4,audio/mpeg"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          disabled={uploading}
        />
        <span>{uploading ? "Uploading…" : "Drop or choose a file (PDF/ZIP/MP4/MP3, max 500MB)"}</span>
      </label>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded border border-border px-3 py-2">
            <div>
              <div className="font-medium">{f.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {f.file_name} · {(f.file_size_bytes / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <button onClick={() => onDelete(f.id)} className="text-sm text-destructive">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Branch product detail page for digital**

In `app/(admin)/admin/shop/products/[id]/page.tsx`, add:

```tsx
import { listFilesForProduct } from "@/lib/db/shop-product-files"
import { countLeadsForProduct } from "@/lib/db/shop-leads"
import { DigitalFileManager } from "./DigitalFileManager"

if (product.product_type === "digital") {
  const files = await listFilesForProduct(product.id)
  const leadsCount = product.digital_is_free
    ? await countLeadsForProduct(product.id)
    : 0
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Identity block (name/slug/description/thumbnail/is_active/is_featured) — reuse shared editor */}
      <section className="rounded-2xl border border-border p-6">
        <h2 className="mb-4 font-heading text-lg">Access settings</h2>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-muted-foreground">Mode</dt><dd>{product.digital_is_free ? "Free (email-gated)" : "Paid (cart)"}</dd></div>
          <div><dt className="text-muted-foreground">Signed URL TTL</dt><dd>{product.digital_signed_url_ttl_seconds}s</dd></div>
          <div><dt className="text-muted-foreground">Access window</dt><dd>{product.digital_access_days ?? "Forever"}</dd></div>
          <div><dt className="text-muted-foreground">Max downloads</dt><dd>{product.digital_max_downloads ?? "Unlimited"}</dd></div>
        </dl>
      </section>
      <section className="rounded-2xl border border-border p-6">
        <h2 className="mb-4 font-heading text-lg">Files</h2>
        <DigitalFileManager productId={product.id} initialFiles={files} />
      </section>
      {product.digital_is_free && (
        <section className="rounded-2xl border border-border p-6">
          <h2 className="mb-2 font-heading text-lg">Leads captured</h2>
          <div className="font-heading text-3xl">{leadsCount}</div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/shop/products app/api/admin/shop/products
git commit -m "feat(admin-shop): add digital product detail panels + file manager"
```

---

### Task 39: Admin order detail — digital fulfillment block

**Files:**
- Modify: `app/(admin)/admin/shop/orders/[id]/page.tsx`

- [ ] **Step 1: Add digital fulfillment section**

```tsx
import { listDownloadsForOrder } from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { DownloadAdminActions } from "./DownloadAdminActions"

// inside the page component, after loading the order:
const hasDigital = order.items.some((i) => i.product_type === "digital")
const downloads = hasDigital ? await listDownloadsForOrder(order.id) : []
const files = await Promise.all(downloads.map((d) => getProductFile(d.file_id)))

// render after the items block:
{hasDigital && (
  <section className="rounded-2xl border border-border p-6">
    <h2 className="mb-4 font-heading text-lg">Digital fulfillment</h2>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th>File</th><th>Downloads</th><th>Expires</th><th>Last download</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {downloads.map((d, i) => (
          <tr key={d.id} className="border-t">
            <td>{files[i]?.display_name ?? "—"}</td>
            <td>{d.download_count}{d.max_downloads != null ? ` / ${d.max_downloads}` : ""}</td>
            <td>{d.access_expires_at ?? "Forever"}</td>
            <td>{d.last_downloaded_at ?? "—"}</td>
            <td><DownloadAdminActions downloadId={d.id} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)}
```

- [ ] **Step 2: Build `DownloadAdminActions` client component**

```tsx
// app/(admin)/admin/shop/orders/[id]/DownloadAdminActions.tsx
"use client"
import { toast } from "sonner"

export function DownloadAdminActions({ downloadId }: { downloadId: string }) {
  async function revoke() {
    if (!confirm("Revoke access to this file?")) return
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/revoke`, { method: "POST" })
    if (res.ok) { toast.success("Revoked"); location.reload() }
  }
  async function extend() {
    const days = prompt("Extend by how many days?", "30")
    if (!days) return
    const expires = new Date(Date.now() + Number(days) * 86_400_000).toISOString()
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/extend`, {
      method: "POST", body: JSON.stringify({ expires_at: expires }),
    })
    if (res.ok) { toast.success("Extended"); location.reload() }
  }
  async function bump() {
    const max = prompt("New max downloads (blank = unlimited)")
    if (max === null) return
    const v = max === "" ? null : Number(max)
    const res = await fetch(`/api/admin/shop/downloads/${downloadId}/max`, {
      method: "POST", body: JSON.stringify({ max: v }),
    })
    if (res.ok) { toast.success("Updated"); location.reload() }
  }
  return (
    <div className="flex gap-2">
      <button onClick={extend} className="rounded border px-2 py-1">Extend</button>
      <button onClick={bump} className="rounded border px-2 py-1">Max</button>
      <button onClick={revoke} className="rounded border border-destructive px-2 py-1 text-destructive">Revoke</button>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/\(admin\)/admin/shop/orders/\[id\]
git commit -m "feat(admin-shop): add digital fulfillment block to order detail"
```

---

### Task 40: Admin leads page + CSV button

**Files:**
- Create: `app/(admin)/admin/shop/leads/page.tsx`
- Create: `app/(admin)/admin/shop/leads/LeadsTable.tsx`
- Create: `app/api/admin/shop/leads/[id]/retry/route.ts`

- [ ] **Step 1: Retry endpoint**

```ts
// app/api/admin/shop/leads/[id]/retry/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { getLead, markLeadFailed, markLeadSynced } from "@/lib/db/shop-leads"
import { addContactToAudience } from "@/lib/shop/resend-audience"
import { getProductById } from "@/lib/db/shop-products"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin()
  const { id } = await params
  const lead = await getLead(id)
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 })
  const product = await getProductById(lead.product_id)
  if (!product) return NextResponse.json({ error: "product gone" }, { status: 404 })
  try {
    const contactId = await addContactToAudience({
      email: lead.email, firstName: null, lastName: null,
      tag: `lead-magnet:${product.slug}`,
    })
    await markLeadSynced(lead.id, contactId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    await markLeadFailed(lead.id, String((e as Error).message ?? e))
    return NextResponse.json({ error: "retry failed" }, { status: 502 })
  }
}
```

- [ ] **Step 2: Page**

```tsx
// app/(admin)/admin/shop/leads/page.tsx
import Link from "next/link"
import { listLeads } from "@/lib/db/shop-leads"
import { listAllProducts } from "@/lib/db/shop-products"
import { LeadsTable } from "./LeadsTable"

type PageProps = { searchParams: Promise<{ product_id?: string; status?: string }> }

export default async function AdminShopLeadsPage({ searchParams }: PageProps) {
  const { product_id, status } = await searchParams
  const products = await listAllProducts()
  const leads = await listLeads({
    productId: product_id,
    status: status as "pending" | "synced" | "failed" | undefined,
    limit: 500,
  })
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-2xl">Shop leads</h1>
        <a
          href={`/api/admin/shop/leads/export${product_id ? `?product_id=${product_id}` : ""}`}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Export CSV
        </a>
      </div>
      <LeadsTable leads={leads} products={products} initialFilter={{ product_id, status }} />
    </div>
  )
}
```

- [ ] **Step 3: Client table (filters + retry)**

```tsx
// app/(admin)/admin/shop/leads/LeadsTable.tsx
"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import type { ShopLead, ShopProduct } from "@/types/database"

export function LeadsTable({
  leads, products, initialFilter,
}: {
  leads: ShopLead[]
  products: ShopProduct[]
  initialFilter: { product_id?: string; status?: string }
}) {
  const router = useRouter()
  const sp = useSearchParams()
  function setParam(k: string, v: string | null) {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v); else next.delete(k)
    router.push(`?${next.toString()}`)
  }
  async function retry(id: string) {
    const res = await fetch(`/api/admin/shop/leads/${id}/retry`, { method: "POST" })
    if (res.ok) { toast.success("Synced"); router.refresh() }
    else toast.error("Retry failed")
  }
  return (
    <>
      <div className="mb-4 flex gap-2">
        <select
          defaultValue={initialFilter.product_id ?? ""}
          onChange={(e) => setParam("product_id", e.target.value || null)}
          className="rounded border px-2 py-1"
        >
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          defaultValue={initialFilter.status ?? ""}
          onChange={(e) => setParam("status", e.target.value || null)}
          className="rounded border px-2 py-1"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="synced">synced</option>
          <option value="failed">failed</option>
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th>Email</th><th>Product</th><th>Status</th><th>Created</th><th></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="border-t">
              <td>{l.email}</td>
              <td>{products.find((p) => p.id === l.product_id)?.name ?? l.product_id}</td>
              <td>{l.resend_sync_status}</td>
              <td>{new Date(l.created_at).toLocaleString()}</td>
              <td>
                {l.resend_sync_status === "failed" && (
                  <button onClick={() => retry(l.id)} className="rounded border px-2 py-1">Retry</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/shop/leads app/api/admin/shop/leads/\[id\]
git commit -m "feat(admin-shop): add leads page with filters, CSV export, and retry"
```

---

### Task 41: Public ProductCard — digital variant

**Files:**
- Modify: `components/public/shop/ProductCard.tsx`

- [ ] **Step 1: Branch on product_type for digital**

Before the existing POD render path, add:

```tsx
if (product.product_type === "digital") {
  const price = product.digital_is_free ? null : minPriceCents
  return (
    <Link href={`/shop/${product.slug}`} className="group block">
      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
        <img src={resolvedThumb} alt={product.name} className="h-full w-full object-cover" />
      </div>
      <div className="mt-3">
        <h3 className="font-heading text-sm">{product.name}</h3>
        <p className="mt-1 font-mono text-xs">
          {product.digital_is_free ? "Free download" : `From $${((price ?? 0)/100).toFixed(2)}`}
        </p>
        <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-widest text-accent">
          Digital
        </span>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/public/shop/ProductCard.tsx
git commit -m "feat(shop): render digital card variant"
```

---

### Task 42: Public PDP — digital branch (free form / paid add-to-cart)

**Files:**
- Modify: `app/(marketing)/shop/[slug]/page.tsx`
- Create: `components/public/shop/FreePdfForm.tsx`

- [ ] **Step 1: Free form client component**

```tsx
// components/public/shop/FreePdfForm.tsx
"use client"
import { useState } from "react"

export function FreePdfForm({ productId }: { productId: string }) {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    const f = new FormData(e.currentTarget)
    const res = await fetch("/api/shop/leads", {
      method: "POST",
      body: JSON.stringify({
        email: String(f.get("email") ?? ""),
        product_id: productId,
        website: String(f.get("website") ?? ""),
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      setError("Something went wrong. Try again.")
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-accent/10 p-6 text-primary">
        <p className="font-heading text-lg">Check your email.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent the download link to your inbox. Didn't arrive? Re-submit below.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Email</span>
        <input name="email" type="email" required className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      {/* Honeypot: hidden from humans */}
      <label aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        website<input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Get free download"}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Branch PDP for digital**

In `app/(marketing)/shop/[slug]/page.tsx`, before the POD rendering, add:

```tsx
if (product.product_type === "digital") {
  const files = await listFilesForProduct(product.id)
  return (
    <article className="mx-auto max-w-5xl px-4 py-12">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <img src={product.thumbnail_url_override ?? product.thumbnail_url} alt={product.name} className="w-full rounded-2xl" />
        <div>
          <h1 className="font-heading text-3xl">{product.name}</h1>
          {product.digital_is_free ? (
            <p className="mt-2 font-mono text-xs uppercase tracking-widest text-accent">Free download</p>
          ) : (
            <p className="mt-2 text-muted-foreground">
              ${((variants[0]?.retail_price_cents ?? 0) / 100).toFixed(2)}
            </p>
          )}
          <div className="prose mt-6" dangerouslySetInnerHTML={{ __html: product.description }} />
          {files.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
              {files.map((f) => <li key={f.id}>• {f.display_name}</li>)}
            </ul>
          )}
          <div className="mt-8">
            {product.digital_is_free ? (
              <FreePdfForm productId={product.id} />
            ) : (
              <AddToCartButton variantId={variants[0]?.id} />
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
```

(Assumes an existing `AddToCartButton` client component used by the POD PDP — reuse it for paid digital.)

- [ ] **Step 3: Commit**

```bash
git add app/\(marketing\)/shop/\[slug\]/page.tsx components/public/shop/FreePdfForm.tsx
git commit -m "feat(shop): render digital PDP with free form or paid add-to-cart"
```

---

### Task 43: Public — /shop/orders/[orderNumber]/downloads page

**Files:**
- Create: `app/(marketing)/shop/orders/[orderNumber]/downloads/page.tsx`
- Create: `app/(marketing)/shop/orders/[orderNumber]/downloads/DownloadsClient.tsx`

- [ ] **Step 1: Page (server) — email gate reuses the same pattern as order-lookup**

```tsx
// app/(marketing)/shop/orders/[orderNumber]/downloads/page.tsx
import { notFound } from "next/navigation"
import { getOrderByNumber } from "@/lib/db/shop-orders"
import { listDownloadsForOrder } from "@/lib/db/shop-order-downloads"
import { getProductFile } from "@/lib/db/shop-product-files"
import { DownloadsClient } from "./DownloadsClient"

export const dynamic = "force-dynamic"

export default async function Page({
  params,
}: {
  params: Promise<{ orderNumber: string }>
}) {
  const { orderNumber } = await params
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()
  const downloads = await listDownloadsForOrder(order.id)
  const rows = await Promise.all(
    downloads.map(async (d) => {
      const file = await getProductFile(d.file_id)
      return { download: d, file }
    }),
  )
  return (
    <DownloadsClient
      orderNumber={order.order_number}
      rows={rows.filter((r) => r.file != null)}
    />
  )
}
```

- [ ] **Step 2: Client component with email gate + per-file download button**

```tsx
// app/(marketing)/shop/orders/[orderNumber]/downloads/DownloadsClient.tsx
"use client"
import { useState } from "react"
import { toast } from "sonner"
import type { ShopOrderDownload, ShopProductFile } from "@/types/database"

type Row = { download: ShopOrderDownload; file: ShopProductFile | null }

export function DownloadsClient({
  orderNumber, rows,
}: { orderNumber: string; rows: Row[] }) {
  const [email, setEmail] = useState("")
  const [unlocked, setUnlocked] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // We don't actually verify here — verification happens server-side on each sign call.
    // Surface bad email earlier by making one probe request.
    setUnlocked(true)
  }

  async function downloadOne(id: string) {
    setBusyId(id)
    const res = await fetch("/api/shop/downloads/sign", {
      method: "POST",
      body: JSON.stringify({ order_number: orderNumber, email, download_id: id }),
    })
    setBusyId(null)
    if (!res.ok) {
      if (res.status === 403) toast.error("Email doesn't match this order")
      else if (res.status === 410) toast.error("Access expired or limit reached")
      else toast.error("Download failed")
      return
    }
    const { url } = await res.json()
    window.location.href = url
  }

  if (!unlocked) {
    return (
      <form onSubmit={unlock} className="mx-auto max-w-md px-4 py-12">
        <h1 className="font-heading text-2xl">Order {orderNumber}</h1>
        <p className="mt-2 text-muted-foreground">
          Enter the email you used at checkout to access your downloads.
        </p>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-4 w-full rounded border px-3 py-2"
        />
        <button type="submit" className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground">
          Show downloads
        </button>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-heading text-2xl">Your downloads</h1>
      <ul className="mt-6 space-y-3">
        {rows.map(({ download, file }) => (
          <li key={download.id} className="flex items-center justify-between rounded border border-border p-4">
            <div>
              <div className="font-medium">{file!.display_name}</div>
              <div className="text-xs text-muted-foreground">
                Downloaded {download.download_count}
                {download.max_downloads != null ? ` / ${download.max_downloads}` : ""} times
              </div>
            </div>
            <button
              disabled={busyId === download.id}
              onClick={() => downloadOne(download.id)}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busyId === download.id ? "Preparing…" : "Download"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/\(marketing\)/shop/orders/\[orderNumber\]/downloads
git commit -m "feat(shop): add public downloads page with email gate"
```

---

### Task 44: Thank-you page — surface digital downloads CTA

**Files:**
- Modify: `app/(marketing)/shop/orders/[orderNumber]/thank-you/page.tsx`

- [ ] **Step 1: Add a digital section if order has any digital items**

```tsx
const hasDigital = order.items.some((i) => i.product_type === "digital")
const hasPod = order.items.some((i) => i.product_type === "pod")

// Render a two-column block:
{hasDigital && (
  <section className="mt-8 rounded-2xl border border-border p-6">
    <h2 className="font-heading text-lg">Your downloads</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      {hasPod
        ? "Your digital files are ready now. Your physical items will ship separately."
        : "Your files are ready now."}
    </p>
    <a
      href={`/shop/orders/${order.order_number}/downloads`}
      className="mt-4 inline-flex rounded-full bg-primary px-5 py-2.5 font-mono text-xs uppercase tracking-widest text-primary-foreground"
    >
      Go to downloads
    </a>
  </section>
)}
{hasPod && (
  <section className="mt-6 rounded-2xl border border-border p-6">
    <h2 className="font-heading text-lg">Shipping to you</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      Your physical order is being prepared. We'll email tracking info when it ships.
    </p>
  </section>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(marketing\)/shop/orders/\[orderNumber\]/thank-you
git commit -m "feat(shop): thank-you page surfaces digital downloads when present"
```

---

### Task 45: E2E — paid digital + free PDF flows

**Files:**
- Create: `__tests__/e2e/shop-digital-paid.spec.ts`
- Create: `__tests__/e2e/shop-digital-free.spec.ts`

- [ ] **Step 1: Paid digital spec**

```ts
// __tests__/e2e/shop-digital-paid.spec.ts
// Assumes seeded paid digital product with slug "e2e-digi-paid" and at least one file,
// and Stripe is in test mode, SHOP_DIGITAL_ENABLED=true.
import { test, expect } from "@playwright/test"

test("paid digital purchase ends on downloads page with a working file", async ({ page }) => {
  await page.goto("/shop/e2e-digi-paid")
  await page.getByRole("button", { name: /add to cart/i }).click()
  await page.goto("/shop/cart")
  await page.getByRole("link", { name: /checkout/i }).click()
  // Fill address, trigger quote, click Pay → Stripe test card
  // (adapt to the project's existing checkout component)
  await page.fill("input[name=email]", "e2e@example.com")
  await page.fill("input[name=line1]", "1 Test St")
  await page.fill("input[name=city]", "Testville")
  await page.fill("input[name=state]", "CA")
  await page.fill("input[name=postal_code]", "94102")
  await page.selectOption("select[name=country]", "US")
  await page.getByRole("button", { name: /pay|continue/i }).click()
  // Stripe test card in Checkout: use test mode redirect to intercept
  await page.waitForURL(/thank-you/)
  await page.getByRole("link", { name: /go to downloads/i }).click()
  await page.fill("input[type=email]", "e2e@example.com")
  await page.getByRole("button", { name: /show downloads/i }).click()
  await expect(page.getByRole("button", { name: /download/i }).first()).toBeVisible()
})
```

- [ ] **Step 2: Free PDF spec**

```ts
// __tests__/e2e/shop-digital-free.spec.ts
// Assumes seeded FREE digital product with slug "e2e-digi-free" and at least one file.
import { test, expect } from "@playwright/test"

test("free PDF flow shows check-your-email state", async ({ page }) => {
  await page.goto("/shop/e2e-digi-free")
  await page.fill("input[type=email]", `e2e-${Date.now()}@example.com`)
  await page.getByRole("button", { name: /get free download/i }).click()
  await expect(page.getByText(/check your email/i)).toBeVisible()
})
```

- [ ] **Step 3: Run Playwright**

```bash
npm run test:e2e -- __tests__/e2e/shop-digital-paid.spec.ts __tests__/e2e/shop-digital-free.spec.ts
```

Expected: both PASS on Chromium at minimum.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/shop-digital-paid.spec.ts __tests__/e2e/shop-digital-free.spec.ts
git commit -m "test(shop): e2e paid digital + free PDF flows"
```

---

### Task 46: Phase 2 checkpoint — full Phase 2 shippable

- [ ] **Step 1: Full suite green**

Run: `npm run test:run`
Expected: green (or only pre-existing unrelated failures).

- [ ] **Step 2: Manual sanity in dev**

- Seed one free and one paid digital product with files.
- Set `SHOP_DIGITAL_ENABLED=true`.
- Submit the free form → check email arrives with signed link.
- Buy the paid one with a Stripe test card → thank-you page shows downloads block → click through → file downloads.
- From admin order detail: extend access, bump max, revoke. Each action visibly affects customer download page.
- Admin leads page shows the submitted free email with `synced` status.

- [ ] **Step 3: Prepare production rollout**

- Flip `SHOP_AFFILIATE_ENABLED=true` first if not already.
- Run one real staff digital purchase to verify end-to-end with live Stripe + Firebase.
- Flip `SHOP_DIGITAL_ENABLED=true`.

Done.
