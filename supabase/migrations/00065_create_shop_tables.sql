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
