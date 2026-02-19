# DJP Athlete Platform — Claude Code Implementation Prompt

## Project Context

You are building **darrenjpaul.com**, a Next.js 16 Progressive Web App for Darren Paul's fitness coaching business. This platform replaces an existing Laravel website + iOS-only app with a single codebase that works on every device.

**This is a Tier 3 (Scale) build** — the full package including Stripe payments, AI exercise assignment, GoHighLevel integration, analytics, SEO, and premium support features.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js (v5) |
| Payments | Stripe (Checkout + Webhooks) |
| AI | OpenAI / Claude API |
| Marketing | GoHighLevel (REST API + Webhooks) |
| Video | YouTube Embeds (iframe API) |
| Hosting | Vercel |
| Testing | Vitest + React Testing Library + Playwright (E2E) |

## Brand

### Color Palette

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| Primary | Green Azure | `#0E3F50` | Headers, nav, buttons, primary actions, dark sections |
| Accent | Gray Orange | `#C49B7A` | Highlights, active states, CTAs, badges, hover accents. Use sparingly (5–10%) |
| Background | White | `#FFFFFF` | Page backgrounds, cards, content areas |
| Text Primary | Dark | `#1A1A1A` | Body text, headings |
| Text Secondary | Gray | `#6B7280` | Captions, labels, secondary info |
| Surface | Light Gray | `#F5F5F5` | Table headers, input backgrounds, section dividers |
| Border | Border Gray | `#E5E7EB` | Card borders, dividers, table borders |
| Success | Green | `#16A34A` | Success states, completed badges |
| Error | Red | `#DC2626` | Error states, destructive actions |
| Warning | Amber | `#D97706` | Warning states, pending badges |

**Color usage rules:**
- Green Azure (`#0E3F50`) is the dominant brand color. Use it for the admin sidebar, navigation bars, primary buttons, and section headers.
- Gray Orange (`#C49B7A`) is the accent. Use it only for highlights: active nav items, hover states on primary buttons, CTA button variants, star ratings, progress bars, and small emphasis details. It should feel like a warm highlight, not a competing primary.
- White is the default background. Keep the design clean and airy.
- Never use Green Azure and Gray Orange at the same weight in one section. One should always dominate.

### Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Headings | **Lexend Exa** | 600–700 | Page titles, section headers, hero text. Matches the logo branding. |
| Body | **Lexend Deca** | 300–500 | Paragraphs, labels, table content, form fields, buttons |
| Mono | **JetBrains Mono** | 400 | Code blocks, data values, stats (if needed) |

**Font notes:**
- Both fonts are from the Lexend family (Google Fonts), designed for readability.
- Lexend Exa has wider letter-spacing which gives headings a bold, athletic feel that matches the "ATHLETE" wordmark in the logo.
- Lexend Deca is the more standard-width variant, perfect for readable body text.
- Import both from Google Fonts in `layout.tsx` using `next/font/google`.
- Heading sizes: H1 = 36px, H2 = 28px, H3 = 22px. Body = 16px. Small = 14px.

### Logo

- **Logo mark:** "djp" in lowercase + "ATHLETE" below in Lexend Exa
- **Variants:** Black version (for light backgrounds), White version (for dark backgrounds like the Green Azure nav/sidebar)
- **Logo files** are provided in the project assets folder (SVG + PNG). Use SVG wherever possible.
- Place the white logo variant on the Green Azure admin sidebar and any dark nav bars.
- Place the black logo variant on the public website header (white background).

### Design Direction

Premium athletic brand. Clean, structured, confident. Think high-end fitness coaching, not a gym bro app.

- Generous white space. Let the content breathe.
- Green Azure gives it depth and authority. Gray Orange gives it warmth and energy.
- Cards with subtle borders (`#E5E7EB`), not heavy shadows.
- Rounded corners: `rounded-lg` (8px) for cards, `rounded-md` (6px) for buttons and inputs.
- Subtle hover transitions (150ms ease) on all interactive elements.
- No gradients unless very subtle (e.g., a slight Green Azure gradient on hero sections).
- Icons: Lucide React icon set. Consistent 20px size in UI, 24px in nav.

---

## Project Structure

```
darrenjpaul/
├── src/
│   ├── app/
│   │   ├── (public)/              # Public website routes
│   │   │   ├── page.tsx           # Landing page
│   │   │   ├── about/
│   │   │   ├── services/
│   │   │   ├── programs/          # Public program store
│   │   │   ├── testimonials/
│   │   │   └── contact/
│   │   ├── (auth)/                # Auth routes
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── forgot-password/
│   │   ├── (client)/              # Client-facing PWA
│   │   │   ├── dashboard/
│   │   │   ├── programs/
│   │   │   ├── questionnaire/
│   │   │   └── profile/
│   │   ├── (admin)/               # Admin dashboard
│   │   │   ├── dashboard/
│   │   │   ├── clients/
│   │   │   ├── exercises/
│   │   │   ├── programs/
│   │   │   ├── payments/
│   │   │   ├── analytics/
│   │   │   ├── reviews/
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/
│   │   │   ├── exercises/
│   │   │   ├── programs/
│   │   │   ├── ai/
│   │   │   ├── stripe/
│   │   │   ├── ghl/
│   │   │   └── notifications/
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                    # Shared UI primitives
│   │   ├── public/                # Public website components
│   │   ├── client/                # Client app components
│   │   ├── admin/                 # Admin dashboard components
│   │   └── forms/                 # Form components
│   ├── lib/
│   │   ├── supabase.ts            # Supabase client
│   │   ├── auth.ts                # NextAuth config
│   │   ├── stripe.ts              # Stripe client
│   │   ├── ai.ts                  # AI engine client
│   │   ├── ghl.ts                 # GoHighLevel client
│   │   ├── youtube.ts             # YouTube embed utils
│   │   └── validators.ts          # Zod schemas
│   ├── hooks/                     # Custom React hooks
│   ├── types/                     # TypeScript types/interfaces
│   ├── utils/                     # Utility functions
│   └── __tests__/                 # Test files mirror src structure
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

---

## Database Schema (Supabase)

Design all tables with these columns by default: `id` (uuid, PK), `created_at` (timestamptz), `updated_at` (timestamptz).

### Core Tables

```sql
-- Users (extended by NextAuth adapter)
users (
  id uuid PK,
  email text UNIQUE NOT NULL,
  name text,
  role enum('admin', 'private_client', 'public_buyer') DEFAULT 'public_buyer',
  avatar_url text,
  is_approved boolean DEFAULT false,
  created_at, updated_at
)

-- Client profiles (filled via questionnaire)
client_profiles (
  id uuid PK,
  user_id uuid FK -> users.id UNIQUE,
  fitness_goals text[],
  fitness_level enum('beginner', 'intermediate', 'advanced'),
  training_history text,
  injuries text,
  available_equipment text[],
  training_days_per_week int,
  session_duration_minutes int,
  exercise_preferences text,
  questionnaire_completed_at timestamptz,
  created_at, updated_at
)

-- Exercise library
exercises (
  id uuid PK,
  name text NOT NULL,
  youtube_url text NOT NULL,
  youtube_embed_id text NOT NULL,
  muscle_groups text[] NOT NULL,
  difficulty enum('beginner', 'intermediate', 'advanced') NOT NULL,
  equipment text[] DEFAULT '{}',
  exercise_type enum('strength', 'mobility', 'core', 'cardio') NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at, updated_at
)

-- Programs (both evergreen store + private assignments)
programs (
  id uuid PK,
  title text NOT NULL,
  description text,
  program_type enum('evergreen', 'private', 'ai_generated') NOT NULL,
  difficulty enum('beginner', 'intermediate', 'advanced'),
  duration_weeks int NOT NULL,
  days_per_week int NOT NULL,
  price_cents int,                    -- null for private programs
  stripe_price_id text,               -- Stripe Price ID for evergreen
  is_published boolean DEFAULT false,
  cover_image_url text,
  created_at, updated_at
)

-- Program structure: which exercises on which day/week
program_exercises (
  id uuid PK,
  program_id uuid FK -> programs.id,
  exercise_id uuid FK -> exercises.id,
  week_number int NOT NULL,
  day_number int NOT NULL,
  order_index int NOT NULL,
  sets int,
  reps text,                          -- "8-12" or "30 sec" etc.
  rest_seconds int,
  notes text,
  created_at
)

-- Program assignments (links users to programs)
program_assignments (
  id uuid PK,
  user_id uuid FK -> users.id,
  program_id uuid FK -> programs.id,
  assigned_by uuid FK -> users.id,    -- admin or 'system' for purchases
  start_date date,
  status enum('active', 'completed', 'paused') DEFAULT 'active',
  source enum('admin_assigned', 'ai_generated', 'purchased') NOT NULL,
  stripe_payment_id text,             -- if purchased
  created_at, updated_at
)

-- Progress tracking
exercise_progress (
  id uuid PK,
  user_id uuid FK -> users.id,
  program_assignment_id uuid FK -> program_assignments.id,
  program_exercise_id uuid FK -> program_exercises.id,
  completed_at timestamptz NOT NULL,
  notes text
)

-- Payments
payments (
  id uuid PK,
  user_id uuid FK -> users.id,
  program_id uuid FK -> programs.id,
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  amount_cents int NOT NULL,
  currency text DEFAULT 'usd',
  status enum('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
  created_at
)

-- Reviews and ratings
reviews (
  id uuid PK,
  user_id uuid FK -> users.id,
  program_id uuid FK -> programs.id,
  program_assignment_id uuid FK -> program_assignments.id,
  rating int NOT NULL CHECK (1-5),
  comment text,
  is_approved boolean DEFAULT false,
  is_featured boolean DEFAULT false,   -- for testimonial page
  created_at, updated_at
)

-- Testimonials (curated for public display)
testimonials (
  id uuid PK,
  review_id uuid FK -> reviews.id,    -- nullable, can be manually added
  client_name text NOT NULL,
  content text NOT NULL,
  photo_url text,
  is_published boolean DEFAULT true,
  display_order int,
  created_at, updated_at
)

-- Notifications log
notifications (
  id uuid PK,
  type enum('new_purchase', 'new_signup', 'new_questionnaire', 'new_review'),
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  metadata jsonb,
  created_at
)
```

### Row Level Security

- Admin role: full access to all tables
- Private clients: read own profile, assignments, progress. Write own progress, reviews.
- Public buyers: read own assignments, progress. Write own progress, reviews.
- Public (unauthenticated): read published programs, published testimonials, active exercises (for store display).

---

## Implementation Phases

Execute each phase sequentially. Each subphase should be independently testable. Write unit tests alongside each feature. Do not move to the next subphase until the current one passes all tests.

### Testing Strategy

- **Unit tests (Vitest):** Every utility function, hook, API route handler, and data validation schema
- **Component tests (React Testing Library):** Every component renders correctly, handles props, user interactions
- **Integration tests (Vitest):** API routes with mocked Supabase/Stripe/AI clients
- **E2E tests (Playwright):** Critical user flows (auth, purchase, program view, admin CRUD)

Test file convention: `src/__tests__/[mirror-path]/[filename].test.ts(x)`

---

## Phase 1: Foundation (Weeks 1–2)

### 1.1 Project Scaffolding

**Goal:** Working Next.js 16 project with all tooling configured.

**Tasks:**
1. Initialize Next.js 16 project with App Router, TypeScript strict mode, Tailwind CSS
2. Configure path aliases (`@/components`, `@/lib`, `@/types`, `@/utils`, `@/hooks`)
3. Set up Vitest with React Testing Library (`vitest.config.ts`, test utils, setup file)
4. Set up Playwright for E2E (`playwright.config.ts`)
5. Configure ESLint + Prettier
6. Set up PWA with `next-pwa` (manifest.json, service worker config, offline fallback page)
7. Create `.env.local` template with all required env vars
8. Initialize folder structure per Project Structure above
9. Create base Tailwind config with brand tokens (primary: #0E3F50, accent: #C49B7A, font families: Lexend Exa + Lexend Deca)

**Tests:**
- `vitest.config.ts` runs successfully with a sample test
- Playwright config validates
- PWA manifest.json passes Lighthouse PWA audit (basic)
- Tailwind config exports correct brand colors (primary, accent) and font families (heading, body)

---

### 1.2 Database Setup

**Goal:** Full Supabase schema with migrations, seed data, and typed client.

**Tasks:**
1. Create Supabase project (or configure local dev with Supabase CLI)
2. Write all migration files per Database Schema above
3. Implement RLS policies for all tables per security spec
4. Create seed file with: 1 admin user, 3 test clients, 20 sample exercises, 2 sample programs
5. Generate TypeScript types from Supabase schema (`supabase gen types`)
6. Create typed Supabase client (`src/lib/supabase.ts`) — server + browser clients
7. Create data access layer (`src/lib/db/`) with functions for each table (CRUD operations)

**Tests:**
- Migration files apply cleanly on fresh database
- RLS policies: admin can read/write all, client can only read own data, public can only read published content
- Supabase client connects and returns typed data
- Each data access function: create, read, update, delete operations
- Seed data loads correctly

---

### 1.3 Authentication

**Goal:** Complete NextAuth.js v5 setup with role-based access.

**Tasks:**
1. Configure NextAuth.js with Supabase adapter
2. Implement credential provider (email + password with bcrypt hashing)
3. Extend session and JWT types to include `role` and `userId`
4. Create auth callback handlers (signIn, jwt, session) to attach role from DB
5. Create middleware for route protection (`src/middleware.ts`):
   - `/admin/*` — admin role only
   - `/client/*` — any authenticated user
   - `/api/admin/*` — admin role only
   - Public routes — no auth required
6. Create auth pages: login, register, forgot password (UI + server actions)
7. Create `useAuth` hook for client-side auth state
8. Create `getServerAuth` helper for server components/API routes
9. Email verification flow on registration

**Tests:**
- Register new user: creates user in DB with correct role
- Login with valid credentials: returns session with role
- Login with invalid credentials: returns error
- JWT callback: attaches role and userId correctly
- Middleware: redirects unauthenticated users from protected routes
- Middleware: returns 403 for non-admin accessing admin routes
- Middleware: allows public access to public routes
- `useAuth` hook returns correct auth state
- `getServerAuth` returns correct session in server context
- Password reset flow: generates token, validates token, updates password

---

### 1.4 Rebranding & Design System

**Goal:** Global design system with all shared UI components using the brand palette.

**Tasks:**
1. Implement brand tokens in Tailwind config:
   - Colors: `primary` (#0E3F50), `accent` (#C49B7A), `surface` (#F5F5F5), plus semantic colors (success, error, warning)
   - Extend with shades: `primary-light`, `primary-dark`, `accent-light`, `accent-dark` (generate 100-900 scale)
   - Font families: `font-heading` (Lexend Exa), `font-body` (Lexend Deca), `font-mono` (JetBrains Mono)
2. Configure `next/font/google` in root layout for Lexend Exa, Lexend Deca, and JetBrains Mono
3. Create UI primitives in `src/components/ui/`:
   - `Button` (variants: primary [Green Azure bg], accent [Gray Orange bg], outline, ghost, danger; sizes: sm, md, lg; hover states use accent highlight)
   - `Input` (text, email, password, textarea, with label + error states. Border focus state uses primary color)
   - `Select` (single, multi-select with search)
   - `Card` (with header, body, footer slots. Subtle border #E5E7EB, rounded-lg)
   - `Badge` (status variants: active [success], inactive [gray], pending [warning], plus brand variants using primary and accent)
   - `Avatar` (image with fallback initials, primary color background)
   - `Modal` (dialog with overlay, close button, body)
   - `Toast` (success, error, info notifications)
   - `Skeleton` (loading placeholder shapes)
   - `Table` (sortable headers with primary color, pagination, row selection. Header bg: surface #F5F5F5)
   - `Tabs` (horizontal tab navigation. Active tab underline uses accent color)
   - `Dropdown` (menu with items, separators, icons)
   - `EmptyState` (icon + message + CTA for empty data views)
   - `Spinner` (loading indicator in primary color)
   - `ProgressBar` (determinate progress display using accent color fill on primary track)
4. Create responsive layout components:
   - `PublicLayout` (white header with black logo, nav links, Green Azure footer)
   - `ClientLayout` (bottom tab nav on mobile, sidebar on desktop. Primary color nav with white logo)
   - `AdminLayout` (Green Azure sidebar with white logo, active nav items highlighted with accent color. White content area with breadcrumbs.)
5. Configure domain `darrenjpaul.com` in Vercel
6. Set up global meta tags, favicon (generate from logo), OG defaults

**Tests:**
- Every UI component: renders without errors, applies correct variant classes, handles all prop combinations
- Button: primary variant uses Green Azure bg, accent variant uses Gray Orange bg, fires onClick, shows loading state, disabled state
- Input: controlled value, validation errors display, focus border uses primary color, label association
- Modal: opens/closes, traps focus, closes on escape/overlay click
- Toast: renders correct variant, auto-dismisses after timeout
- Table: sorts by column, paginates, selects rows, header uses surface bg
- Tabs: active tab uses accent underline
- ProgressBar: accent fill renders at correct width percentage
- Layouts: render children, responsive breakpoints apply correctly
- AdminLayout: sidebar uses primary color bg, active nav item uses accent highlight, white logo renders
- PublicLayout: black logo renders on white header
- Fonts: Lexend Exa loads for headings, Lexend Deca loads for body text (check computed styles)

---

### 1.5 Admin Dashboard Shell

**Goal:** Working admin layout with navigation and placeholder pages.

**Tasks:**
1. Build admin sidebar with Green Azure (`#0E3F50`) background:
   - White djpATHLETE logo at top of sidebar
   - Navigation links: Dashboard (home), Clients, Exercises, Programs, Payments, Analytics, Reviews, Settings
   - Active nav item highlighted with Gray Orange (`#C49B7A`) left border or background tint
   - Nav text in white, icons from Lucide React
2. Implement sidebar collapse/expand (desktop) and drawer (mobile)
3. Admin top bar (white bg) with breadcrumbs, notification bell (count badge with accent color), user menu dropdown
4. Create placeholder pages for each admin route
5. Client list page (read from DB):
   - Table with columns: Name, Email, Role, Status (approved/pending), Joined Date
   - Search by name/email
   - Filter by role, status
   - Pagination (10, 25, 50 per page)
   - Click row to view client detail (placeholder)
6. Admin route guard (redirect to login if not admin)

**Tests:**
- Sidebar renders all navigation items with correct icons
- Sidebar background uses primary Green Azure color
- Active nav item shows accent highlight
- White logo renders in sidebar
- Sidebar collapses/expands on desktop
- Mobile drawer opens/closes
- Breadcrumbs show correct path
- Client list: renders table with data, search filters results, pagination works
- Client list: empty state shows when no results
- Route guard: redirects non-admin users

---

## Phase 2: Core Platform (Weeks 3–5)

### 2.1 Public Website — Landing Page

**Goal:** High-converting landing page for darrenjpaul.com.

**Tasks:**
1. Hero section: headline in Lexend Exa, subheadline in Lexend Deca, primary CTA button (Green Azure with accent hover), hero image/video background
2. Social proof bar (client count, results stats) — subtle surface background
3. Services overview section (3-4 cards with subtle borders, accent-colored icons or highlights)
4. How it works section (3-step process, numbered with accent color)
5. Featured testimonials section (carousel or grid, star ratings in Gray Orange accent)
6. CTA section (full-width Green Azure background, white text, accent CTA button)
7. Footer with Green Azure background, white text, links, contact info, social links, white logo
8. Mobile responsive across all breakpoints
9. Implement smooth scroll animations on section entry

**Tests:**
- Page renders all sections
- CTA buttons link to correct routes
- Responsive layout at mobile/tablet/desktop breakpoints
- Social proof section renders dynamic data
- Testimonial section renders from data prop

---

### 2.2 Public Website — Static Pages

**Goal:** About, Services, Contact, and Testimonials pages.

**Tasks:**
1. **About page:** Coach bio, credentials, training philosophy, personal story, image
2. **Services page:** Training offerings grid, pricing info, what to expect, CTA
3. **Contact page:** Contact form (name, email, subject, message), form validation with Zod
4. **Testimonials page:** Grid of approved testimonials from DB, star ratings, client photos
5. Newsletter signup component (reusable, appears on multiple pages)
6. SEO for all pages: unique meta titles/descriptions, Open Graph tags, structured data (JSON-LD)
7. Generate `sitemap.xml` and `robots.txt`

**Tests:**
- Each page renders correct content and structure
- Contact form: validates required fields, shows errors for invalid input, submits successfully
- Newsletter component: validates email, shows success/error state
- SEO: correct meta tags render in head for each page
- Sitemap includes all public routes
- Testimonials page: fetches and renders approved testimonials only

---

### 2.3 Exercise Library (Admin)

**Goal:** Full CRUD for exercises with YouTube integration.

**Tasks:**
1. **API routes** (`src/app/api/exercises/`):
   - `GET /api/exercises` — list with pagination, search, filters (muscle group, difficulty, equipment, type)
   - `GET /api/exercises/[id]` — single exercise
   - `POST /api/exercises` — create (admin only)
   - `PUT /api/exercises/[id]` — update (admin only)
   - `DELETE /api/exercises/[id]` — soft delete / deactivate (admin only)
   - `POST /api/exercises/bulk-import` — CSV import (admin only)
2. **Zod validation schemas** for exercise create/update
3. **YouTube URL parser:** extract video ID from various YouTube URL formats, generate embed URL
4. **Admin exercise list page:**
   - Table view with columns: Name, Muscle Groups, Difficulty, Equipment, Type, Status
   - Search bar (full-text across name, description)
   - Multi-filter dropdowns: muscle group, difficulty, equipment, type
   - Bulk actions: activate, deactivate, delete selected
5. **Admin exercise form** (create + edit, shared component):
   - Fields: name, YouTube URL (with preview embed), muscle groups (multi-select), difficulty, equipment (multi-select), exercise type, description
   - YouTube URL auto-validates and shows video preview on paste
6. **CSV bulk import:**
   - Upload CSV with columns: name, youtube_url, muscle_groups, difficulty, equipment, exercise_type
   - Preview table before import
   - Validation per row with error reporting
   - Import progress indicator

**Tests:**
- API: GET returns paginated results, respects filters, search works
- API: POST creates exercise with valid data, rejects invalid data
- API: PUT updates exercise, returns 404 for non-existent
- API: DELETE deactivates exercise
- API: bulk import processes valid CSV, reports row-level errors
- API: all admin endpoints return 403 for non-admin
- Zod schemas: validate correct data, reject invalid data for every field
- YouTube parser: extracts ID from youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
- Exercise list: renders table, search filters, pagination, bulk actions
- Exercise form: validates on submit, shows YouTube preview, handles create and edit modes
- CSV import: preview renders, validation errors display per row

---

### 2.4 Program Management (Admin)

**Goal:** Program builder with week/day structure, exercise assignment, and management.

**Tasks:**
1. **API routes** (`src/app/api/programs/`):
   - `GET /api/programs` — list (with type filter: evergreen, private, ai_generated)
   - `GET /api/programs/[id]` — full program with exercises (joined)
   - `POST /api/programs` — create program shell
   - `PUT /api/programs/[id]` — update program metadata
   - `DELETE /api/programs/[id]` — delete (only if no active assignments)
   - `POST /api/programs/[id]/exercises` — add exercise to program (with week, day, order)
   - `PUT /api/programs/[id]/exercises/[exerciseId]` — update exercise placement (sets, reps, rest, notes)
   - `DELETE /api/programs/[id]/exercises/[exerciseId]` — remove exercise from program
   - `POST /api/programs/[id]/duplicate` — clone program as new draft
   - `POST /api/programs/[id]/assign` — assign program to client
2. **Zod schemas** for program create/update, exercise placement, assignment
3. **Admin program list page:**
   - Cards or table: Title, Type, Duration, Status (draft/published/archived), Assignments count
   - Filter by type, status
   - Quick actions: edit, duplicate, archive, delete
4. **Program builder page:**
   - Program metadata form: title, description, type, difficulty, duration (weeks), days per week, price (if evergreen), cover image
   - Week/Day grid view: visual layout showing exercises per day per week
   - Add exercise to day: search/filter exercise library in modal, select, set sets/reps/rest/notes
   - Drag-and-drop reorder exercises within a day
   - Drag exercises between days
   - Remove exercise from day
   - Duplicate a week (copy all exercises to new week)
5. **Program assignment:**
   - Select client from dropdown (search by name/email)
   - Set start date
   - Confirm and create assignment

**Tests:**
- API: CRUD operations for programs (create, read, update, delete)
- API: add/update/remove exercises from program
- API: duplicate creates exact copy with new ID, draft status
- API: assign creates assignment record with correct source
- API: delete blocked if active assignments exist
- Zod: all program schemas validate/reject correctly
- Program list: renders programs, filters work, quick actions fire correctly
- Program builder: metadata form validates, week/day grid renders exercises
- Program builder: add exercise modal searches library, adds to correct day
- Program builder: drag-and-drop reorders (unit test the reorder logic, not DnD UI)
- Assignment: client dropdown filters, assignment creation works

---

### 2.5 Stripe Integration & Program Store

**Goal:** Public storefront with Stripe checkout and instant access.

**Tasks:**
1. **Stripe setup** (`src/lib/stripe.ts`):
   - Initialize Stripe client (server-side)
   - Helper: create Stripe Product + Price for evergreen programs
   - Helper: create Checkout Session with metadata (programId, userId)
   - Helper: verify webhook signature
2. **API routes:**
   - `POST /api/stripe/checkout` — create checkout session (public, must be authenticated)
   - `POST /api/stripe/webhook` — handle Stripe events (payment_intent.succeeded, checkout.session.completed, charge.refunded)
   - `GET /api/payments` — admin list all payments
   - `GET /api/payments/[id]` — admin view single payment
3. **Webhook handler logic:**
   - On `checkout.session.completed`:
     - Create payment record in DB
     - Create program assignment (source: 'purchased')
     - Send notification to admin
     - Trigger GHL webhook (wired in Phase 3, prepare the hook)
4. **Public program store page** (`/programs`):
   - Grid of published evergreen programs
   - Program card: cover image, title, description preview, difficulty badge, duration, price, average rating (Gray Orange stars)
   - Click to view program detail page
5. **Program detail page** (`/programs/[id]`):
   - Full description, difficulty, duration, what's included
   - Week-by-week overview (exercise names, no video embeds for non-buyers)
   - Reviews section (approved reviews with ratings)
   - "Buy Now" button -> Stripe Checkout
   - If already purchased: "Go to Program" button instead
6. **Post-purchase flow:**
   - Stripe redirects to success page
   - Success page confirms purchase, creates account if needed
   - "Start Training" button -> client program view
7. **Admin payments page:**
   - Table: Date, Client, Program, Amount, Status
   - Revenue summary cards: total revenue, this month, transaction count
   - Click to view payment detail (Stripe payment ID, session ID, client info)

**Tests:**
- Stripe client: initializes correctly with API key
- Checkout session: creates with correct metadata, line items, redirect URLs
- Webhook signature: validates correct signature, rejects invalid
- Webhook handler: creates payment record, creates assignment, fires notification hook
- Webhook handler: handles duplicate events idempotently (same session_id)
- Webhook handler: handles refund events correctly
- Program store: renders only published evergreen programs
- Program store: card displays correct data
- Program detail: shows buy button for non-owners, go-to button for owners
- Program detail: hides video embeds for non-purchasers
- Post-purchase: success page renders, account creation works
- Admin payments: table renders, revenue summary calculates correctly

---

### 2.6 Client Questionnaire & Onboarding

**Goal:** Multi-step questionnaire that feeds into client profiles and AI assignment.

**Tasks:**
1. **API routes:**
   - `POST /api/questionnaire` — submit questionnaire (creates/updates client_profile)
   - `GET /api/questionnaire` — get current user's questionnaire responses
   - `GET /api/admin/questionnaires` — admin list all submitted questionnaires
   - `GET /api/admin/questionnaires/[userId]` — admin view specific client responses
2. **Zod validation** for questionnaire submission
3. **Multi-step questionnaire flow** (`/client/questionnaire`):
   - Step 1: Fitness Goals (multi-select: weight loss, muscle gain, endurance, flexibility, sport-specific, general health)
   - Step 2: Current Fitness Level (single select: beginner, intermediate, advanced)
   - Step 3: Training History (text area: experience, current routine)
   - Step 4: Injuries & Limitations (text area with common injury checkboxes)
   - Step 5: Available Equipment (multi-select: bodyweight, dumbbells, barbell, bands, kettlebell, machines, cable, pull-up bar)
   - Step 6: Schedule (training days per week slider 1-7, session duration: 30/45/60/75/90 min)
   - Step 7: Exercise Preferences (text area: likes, dislikes, any other notes)
   - Step 8: Review & Submit (summary of all answers, edit any step)
   - Progress indicator across all steps
   - Data persists across steps (React state, not lost on accidental navigation)
4. **Private client application flow:**
   - Register -> Complete questionnaire -> Status: "Pending Approval"
   - Admin sees pending clients in client list
   - Admin can approve/reject with notes
   - On approval: client gets email notification, can now view assigned programs
5. **Admin questionnaire view:**
   - Client detail page shows questionnaire responses in readable format
   - Quick reference sidebar when assigning programs or reviewing AI output

**Tests:**
- API: POST validates all questionnaire fields, creates client_profile record
- API: GET returns current user's responses (empty if not submitted)
- API: admin endpoints return 403 for non-admin
- Zod: questionnaire schema validates correct data, rejects missing required fields
- Questionnaire flow: each step renders correct fields
- Questionnaire flow: navigation between steps preserves data
- Questionnaire flow: review step shows all entered data
- Questionnaire flow: submit creates client profile in DB
- Progress indicator reflects current step
- Private client flow: pending status after submission, approved status after admin action
- Admin view: renders questionnaire responses correctly

---

### 2.7 AI Exercise Assignment Engine

**Goal:** AI reads questionnaire data + exercise library and generates complete programs.

**Tasks:**
1. **AI client** (`src/lib/ai.ts`):
   - Initialize OpenAI/Claude client
   - System prompt engineering for exercise matching
   - Structured output format (JSON) for program generation
   - Token usage tracking utility
2. **AI system prompt** — include these constraints:
   - No duplicate exercises within a single program
   - Balance muscle groups across the training week
   - Difficulty-appropriate exercises matching client level
   - Avoid exercises conflicting with reported injuries
   - Respect equipment availability
   - Progressive structure across weeks
   - Match session duration targets
   - Return structured JSON: `{ weeks: [{ days: [{ exercises: [{ exerciseId, sets, reps, rest, notes }] }] }] }`
3. **API routes:**
   - `POST /api/ai/generate` — generate program from client profile (admin only)
     - Input: userId (uses their questionnaire data)
     - Process: fetch client profile, fetch exercise library, call AI, validate output
     - Output: draft program (not yet assigned)
   - `POST /api/ai/regenerate` — regenerate with adjusted params (admin only)
   - `GET /api/ai/usage` — token usage stats (admin only)
4. **AI output validation:**
   - Verify all exerciseIds exist in the library
   - Verify no duplicates within program
   - Verify equipment constraints are met
   - Verify injury constraints are respected
   - If validation fails: auto-retry once with feedback to AI about what was wrong
5. **Admin AI review interface:**
   - After generation: show proposed program in week/day grid
   - Each exercise shows: name, YouTube thumbnail, sets/reps/rest
   - "Swap Exercise" button: opens exercise library picker, replaces exercise
   - "Regenerate" button: re-runs AI with optional adjusted parameters
   - "Approve & Assign" button: creates program + assignment, notifies client
   - "Edit" button: switch to manual program builder mode with AI output pre-filled
6. **Cost tracking:**
   - Log every API call: model, input tokens, output tokens, cost estimate
   - Admin can view aggregate usage stats

**Tests:**
- AI client: calls API with correct system prompt and user data
- AI client: parses structured JSON response correctly
- AI client: handles API errors gracefully (timeout, rate limit, invalid response)
- System prompt: generates valid JSON structure (test with mock/fixture)
- Validation: catches duplicate exercises
- Validation: catches invalid exercise IDs
- Validation: catches equipment constraint violations
- Validation: catches injury constraint violations
- Auto-retry: triggers on validation failure, includes error feedback
- API: generate creates draft program from client profile
- API: regenerate creates new draft, preserves original
- API: all endpoints admin-only
- Review interface: renders week/day grid with exercises
- Review interface: swap exercise replaces correctly
- Review interface: approve creates program + assignment
- Token tracking: logs usage per call, aggregates correctly

---

### 2.8 Client-Facing PWA

**Goal:** The training experience clients use daily.

**Tasks:**
1. **Client dashboard** (`/client/dashboard`):
   - Active program card (current program with progress percentage)
   - Quick stats: exercises completed this week, streak count
   - "Complete Questionnaire" CTA if not yet submitted
   - Recent activity feed
2. **Program view** (`/client/programs/[assignmentId]`):
   - Week selector (tabs or horizontal scroll)
   - Day view: list of exercises for selected day
   - Each exercise: name, YouTube video embed, sets/reps/rest info, notes
   - "Mark Complete" checkbox per exercise
   - Day progress bar (X of Y exercises complete, accent color fill)
   - Week progress bar
   - Overall program progress bar (accent color fill on primary track)
3. **Progress tracking:**
   - Completing an exercise creates `exercise_progress` record
   - Unchecking removes the record
   - Progress persists across sessions (DB-backed)
   - Weekly summary view
4. **Client profile** (`/client/profile`):
   - View/edit personal info
   - View questionnaire responses (read-only after submission)
   - Change password
   - Notification preferences
5. **PWA optimizations:**
   - Home screen install prompt (custom UI, not just browser default)
   - Offline viewing: cache assigned program data via service worker
   - Program data pre-fetched when assigned
   - Smooth transitions between views
   - Pull-to-refresh on program view
   - Skeleton loading states everywhere

**Tests:**
- Client dashboard: renders active program, progress stats, CTA if no questionnaire
- Client dashboard: handles no active program (empty state)
- Program view: renders correct exercises for selected week/day
- Program view: YouTube embed renders with correct video ID
- Program view: mark complete creates progress record
- Program view: unmark deletes progress record
- Program view: progress bar calculates correctly (X completed / Y total)
- Profile: renders user data, edit form saves changes
- PWA: manifest.json is valid, service worker registers
- PWA: offline fallback page renders when offline
- Progress data: persists across page reloads

---

## Phase 3: Integrations & Features (Weeks 6–8)

### 3.1 GoHighLevel Integration

**Goal:** Website events automatically flow to GHL for marketing automation.

**Tasks:**
1. **GHL client** (`src/lib/ghl.ts`):
   - API client with auth (API key or OAuth)
   - Create/update contact
   - Add contact to workflow
   - Trigger custom webhook
   - Error handling with retry logic (exponential backoff)
2. **API routes:**
   - `POST /api/ghl/contact` — create/update GHL contact
   - `POST /api/ghl/webhook` — outbound webhook trigger
3. **Integration points** (update existing features):
   - Contact form submission -> create GHL contact + trigger "New Inquiry" workflow
   - Newsletter signup -> create GHL contact + add to newsletter list
   - New client registration -> create GHL contact + trigger "New Client" workflow
   - Stripe purchase -> trigger "New Purchase" workflow with product info
   - Questionnaire completed -> trigger "Questionnaire Complete" workflow
4. **Automated welcome email:**
   - Trigger GHL email template on new registration
   - Trigger GHL email template on program purchase
5. **Error handling:**
   - Failed webhook calls logged to `notifications` table
   - Retry queue for failed calls (3 retries with backoff)
   - Admin can view failed webhook logs in settings

**Tests:**
- GHL client: creates contact with correct fields
- GHL client: triggers webhook with correct payload
- GHL client: retries on failure (mock 500 response, verify retry count)
- GHL client: gives up after max retries, logs failure
- Contact form -> GHL: creates contact on form submission
- Newsletter -> GHL: creates contact with correct list tag
- Purchase -> GHL: triggers workflow with product and price data
- Failed webhook: creates notification record, retries correctly
- All integration points: function correctly when GHL is unavailable (graceful degradation, don't block main operation)

---

### 3.2 Analytics Dashboard (Admin)

**Goal:** Admin overview of traffic, revenue, and client metrics.

**Tasks:**
1. **API routes:**
   - `GET /api/analytics/revenue` — revenue metrics (total, this month, by program, by date range)
   - `GET /api/analytics/clients` — client metrics (total, new this month, active, churn)
   - `GET /api/analytics/programs` — program metrics (sales by program, completion rates, avg rating)
   - All accept `startDate` and `endDate` query params
2. **Admin analytics page:**
   - Summary cards row: Total Revenue, New Clients (this month), Active Programs, Avg Rating
   - Revenue chart: line chart showing revenue over time (daily/weekly/monthly)
   - Sales by program: bar chart showing which programs sell most
   - Client growth: line chart showing new signups over time
   - Program performance: table with program name, sales, avg rating, completion rate
   - Date range picker that filters all charts/cards
3. **Data aggregation queries:**
   - Revenue by date range (from payments table)
   - Client signups by date range (from users table)
   - Program sales count and revenue (from payments + programs join)
   - Completion rate: assignments completed / total assignments per program
   - Average rating per program (from reviews table)

**Tests:**
- API: revenue endpoint returns correct totals for date range
- API: revenue endpoint handles empty date range (all time)
- API: client metrics return correct counts
- API: program metrics return correct sales, ratings, completion rates
- API: all endpoints admin-only
- Dashboard: summary cards render correct numbers
- Dashboard: charts render with data
- Dashboard: date range picker filters all data correctly
- Dashboard: handles zero data gracefully (no errors, shows empty state)
- Aggregation queries: correct calculations with known test data

---

### 3.3 Email Notifications

**Goal:** Admin gets notified of key events in real-time.

**Tasks:**
1. **Notification service** (`src/lib/notifications.ts`):
   - Create notification record in DB
   - Send email notification (use Resend, Supabase email, or simple SMTP)
   - Respect admin notification preferences
2. **Notification triggers** (update existing features):
   - New purchase: "[Client Name] purchased [Program Name] for $XX"
   - New client signup: "[Name] registered as a new client"
   - Questionnaire completed: "[Client Name] completed their questionnaire"
   - New review submitted: "[Client Name] left a [X]-star review on [Program]"
3. **Admin notification center:**
   - Bell icon in admin top bar with unread count
   - Dropdown panel: list of recent notifications
   - Click notification to navigate to relevant page
   - "Mark all as read" action
   - Full notifications page with all history
4. **Admin notification preferences** (settings page):
   - Toggle per notification type: in-app only, in-app + email, off
   - Email address for notifications (default: admin login email)

**Tests:**
- Notification service: creates DB record with correct type, title, message
- Notification service: sends email when preference is enabled
- Notification service: skips email when preference is off
- Notification triggers: fire on correct events (mock the upstream actions)
- Notification center: renders notifications, shows unread count
- Notification center: mark as read updates DB
- Notification center: click navigates to correct page
- Preferences: toggle updates DB, affects notification behavior

---

### 3.4 Program Ratings & Reviews

**Goal:** Clients rate programs, admin moderates, reviews display on store.

**Tasks:**
1. **API routes:**
   - `POST /api/reviews` — submit review (authenticated, must own completed assignment)
   - `GET /api/reviews/program/[programId]` — get approved reviews for program (public)
   - `GET /api/admin/reviews` — all reviews with moderation status (admin)
   - `PUT /api/admin/reviews/[id]` — approve/reject/feature review (admin)
2. **Client review flow:**
   - After completing a program (all exercises done), show "Rate this program" prompt
   - Star rating (1-5) + optional written review
   - "Thank you" confirmation after submission
   - Can view own submitted review
3. **Admin review moderation:**
   - List all reviews: client name, program, rating, excerpt, status (pending/approved/rejected/featured)
   - Filter by status, program, rating
   - Approve, reject, or feature (for testimonial page) actions
   - Bulk approve/reject selected reviews
4. **Store integration:**
   - Program detail page shows approved reviews
   - Program card shows average rating (stars) and review count
   - Testimonials page shows featured reviews
5. **Testimonials page update:**
   - Pull from featured reviews + manually added testimonials
   - Display: client name, star rating, review text, client photo (if available)

**Tests:**
- API: POST creates review, rejects if no completed assignment
- API: POST rejects duplicate review (one per assignment)
- API: GET public only returns approved reviews
- API: admin CRUD works, moderation actions update status
- Client flow: rate prompt appears on program completion
- Client flow: star rating required, comment optional
- Admin moderation: filter and bulk actions work correctly
- Store: program card shows correct avg rating
- Store: program detail shows approved reviews only
- Testimonials page: shows featured reviews + manual testimonials

---

### 3.5 Mobile-First Design Polish

**Goal:** PWA feels like a native app, not a website.

**Tasks:**
1. Audit all client-facing pages for mobile UX:
   - Touch targets minimum 44x44px
   - No horizontal scroll on any viewport
   - Bottom navigation is thumb-friendly
2. Add page transitions (subtle slide/fade between routes)
3. Replace all loading spinners with skeleton screens
4. Add pull-to-refresh on client dashboard and program view
5. Optimize YouTube embeds: lazy load, proper aspect ratio, loading placeholder
6. Improve PWA service worker:
   - Cache program data for offline viewing
   - Cache exercise metadata and thumbnails
   - Network-first for API calls, cache-first for static assets
   - Background sync for progress tracking (mark complete offline, sync when online)
7. Add haptic-style visual feedback on button presses (scale transform + opacity)
8. Implement smooth scroll behavior on all anchor links
9. Optimize images: next/image with proper sizing, WebP format, blur placeholders

**Tests:**
- No horizontal overflow on any page at 320px viewport width
- Touch targets: all interactive elements >= 44x44px (visual regression or DOM check)
- Skeleton screens: render on every page with loading state
- YouTube embed: lazy loads (not loaded until visible)
- Service worker: caches program data, serves from cache when offline
- Background sync: queues progress updates offline, syncs on reconnect
- Page transitions: fire on route change (check animation class presence)

---

### 3.6 Cross-Device Testing

**Goal:** Everything works perfectly on every device and browser.

**Tasks:**
1. **Playwright E2E test suite** covering critical flows:
   - Full auth flow: register, login, logout, password reset
   - Public buyer flow: browse store, view program, purchase (Stripe test mode), access program
   - Private client flow: register, questionnaire, wait for approval, view assigned program
   - Admin flow: create exercise, build program, assign to client, review AI output
   - Progress tracking: mark exercises complete, verify progress persists
2. Run E2E tests across viewports: mobile (375px), tablet (768px), desktop (1440px)
3. Manual testing checklist:
   - iPhone Safari (PWA install, offline, video playback)
   - Android Chrome (install prompt, push notifications, full features)
   - iPad Safari (layout, touch interactions)
   - Desktop: Chrome, Safari, Firefox, Edge
4. Fix all identified issues
5. Performance audit: Lighthouse scores > 90 for Performance, Accessibility, Best Practices, SEO

**Tests:**
- All Playwright E2E tests pass at all three viewport sizes
- Lighthouse CI: Performance > 90, Accessibility > 90, Best Practices > 90, SEO > 90
- No console errors on any page at any viewport

---

## Phase 4: Polish & Launch (Weeks 8–10)

### 4.1 UI/UX Final Audit

**Goal:** Every page is polished, consistent, and production-ready.

**Tasks:**
1. Full visual audit: consistent spacing, fonts, colors across all pages
2. Copy review: button labels, error messages, empty states, tooltips
3. Error pages: custom 404, 500, and offline fallback pages (branded)
4. Loading states: every data-fetching page has a loading.tsx
5. Accessibility: keyboard navigation on all interactive elements, contrast ratios pass WCAG AA, alt text on all images
6. Performance: code splitting, lazy loading for heavy components, image optimization, bundle analysis

**Tests:**
- Accessibility: axe-core audit passes on all pages (integrate with Playwright)
- 404 page: renders on invalid routes
- 500 page: renders on server error
- Loading states: every route has a loading.tsx that renders skeleton
- Bundle size: main JS bundle < 200KB gzipped

---

### 4.2 Production Deployment

**Goal:** Platform is live at darrenjpaul.com.

**Tasks:**
1. Vercel production environment:
   - All environment variables set (Supabase, Stripe live keys, AI API key, GHL API key, NextAuth secret)
   - Custom domain configured with SSL
   - Build passes with zero warnings
2. Supabase production:
   - Production project created
   - All migrations applied
   - RLS policies verified
   - Backup schedule configured
3. Stripe live mode:
   - Switch from test to live API keys
   - Verify webhook endpoint with live signing secret
   - Create products/prices for all evergreen programs
4. GoHighLevel production:
   - Update all webhook URLs to production domain
   - Test each integration point with live GHL account
5. Monitoring:
   - Error tracking (Vercel analytics or Sentry)
   - Uptime monitoring
   - Database connection monitoring
6. Final smoke test of all features in production

**Tests:**
- Production build: zero errors, zero warnings
- All API endpoints return correct responses
- Stripe webhook: test event fires and processes correctly
- GHL webhooks: contact creation, workflow triggers work
- Auth: login/register/password reset work with production NextAuth config
- PWA: installable from production domain, correct icons and splash screens

---

### 4.3 Data Migration

**Goal:** Existing client data from Laravel system moved to new platform.

**Tasks:**
1. Export existing client data from Laravel system (CSV or JSON)
2. Write migration script:
   - Map old user records to new `users` table schema
   - Map old program data to new `programs` + `program_exercises` schema
   - Map old assignment data to new `program_assignments` schema
3. Validate migrated data:
   - All users can log in (generate password reset emails)
   - All program assignments are intact
   - No orphaned records
4. Run migration on production after deployment

**Tests:**
- Migration script: transforms sample old data to new schema correctly
- Migration script: handles missing/null fields gracefully
- Migration script: reports errors for unmappable records
- Post-migration: record counts match expected totals
- Post-migration: spot-check 5 random clients have correct data

---

### 4.4 Documentation & Handoff

**Goal:** Client can manage the platform independently.

**Tasks:**
1. Admin user guide (markdown):
   - How to add exercises to the library
   - How to build a program manually
   - How to use AI to generate a program
   - How to manage clients (approve, assign programs)
   - How to manage the program store (publish, price, update)
   - How to moderate reviews
   - How to read the analytics dashboard
   - Common troubleshooting (Stripe issues, GHL webhook failures)
2. Technical documentation (markdown):
   - Project architecture overview
   - Environment variables reference
   - Database schema documentation
   - API endpoints reference
   - Deployment guide (Vercel)
   - How to add new features or modify existing ones
3. GitHub repository:
   - Clean README.md with setup instructions
   - Branch protection on main
   - All environment variables documented

**Tests:**
- Documentation: all links in docs are valid
- README: setup instructions work on a clean environment
- All documented API endpoints exist and return expected responses

---

## Global Rules

1. **TypeScript strict mode.** No `any` types. Every function has explicit return types. Every prop has an interface.
2. **Zod validation** on every API route input. Never trust client data.
3. **Error handling** everywhere. API routes return consistent error format: `{ error: string, code: string, details?: any }`.
4. **Server components by default.** Only use `"use client"` when you need interactivity, hooks, or browser APIs.
5. **Server actions** for form submissions where appropriate.
6. **No inline styles.** Tailwind only.
7. **Commit after each subphase.** Meaningful commit messages: `feat(1.3): implement NextAuth authentication with role-based access`.
8. **No TODO comments** in committed code. Either implement it or track it as an issue.
9. **Environment variables** for all external service keys. Never hardcode.
10. **Consistent naming:** camelCase for variables/functions, PascalCase for components/types, snake_case for database columns, kebab-case for routes.