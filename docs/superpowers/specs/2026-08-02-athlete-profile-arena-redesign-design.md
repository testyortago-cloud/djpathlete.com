# Athlete Profile Share Card — "Full Arena" Redesign

**Date:** 2026-08-02
**Goal:** Make `/athlete/<token>` a presentation-grade page the coach can put in front of a client (or a parent) and get a "wow". The current card is a dark hero band on a plain white dashboard body; the redesign commits the whole page to the dark broadcast-package aesthetic the hero already hints at (FIBA player card / ESPN lower-third).

## Decisions (made autonomously — session is in away mode)

1. **Full dark takeover, not hero-only.** The entire page becomes a deep arena-azure field with the warm Gray Orange as metallic accent. A dark page reads as a *presentation*; a white page reads as a *report*.
2. **Scoped token remap, no hardcoded colors in components.** A new `.athlete-arena` class in `globals.css` redefines the semantic CSS variables (`--background`, `--card`, `--border`, `--muted-foreground`, `--surface`, `--primary` → ice-azure ink, `--accent-foreground` → light) for everything inside the page. Components keep using `bg-card`, `text-primary`, `border-border`, and the Recharts radar (which reads `var(--border)` etc.) restyles itself for free. This respects the "no hardcoded hex, semantic classes only" brand rule.
3. **The PDF stays dark.** `print-color-adjust: exact` on the page root — Save-as-PDF produces the same cinematic card, like a deck slide. The PDF's primary use is digital sharing, not laser printing. (Previous behavior was dark hero + white body.)
4. **Existing data layer untouched.** `lib/profile-share/data.ts`, token, page.tsx routing/metadata all stay as-is. This is a pure presentation-layer redesign of `components/public/athlete/*` + a small OG-image refresh.
5. **Existing tests must stay green** — the redesign preserves the load-bearing strings ("Training with DJP since …", "185 LBS" as a single text node, section names, stat labels).

## Section-by-section

- **Hero:** oversized stacked name (first name white, last name accent, clamp up to ~6rem, uppercase, tight leading), avatar with layered accent ring + glow, outlined giant initials watermark (`-webkit-text-stroke`, near-transparent fill), mono meta line (sport · position · level). Physicals move from small pills to a **broadcast spec bar** — hairline-framed columns (HEIGHT / WEIGHT / AGE) with mono labels and heading-font values; null columns omitted. "Training with DJP since <Mon YYYY>" survives as the hero's bottom credential line. Staggered FadeIn entrance.
- **Stat strip:** the four counters become one glassy scoreboard panel (single rounded panel, internal hairline dividers, 2×2 → 1×4) overlapping the hero edge. Counter animation + beforeprint snap logic kept verbatim.
- **Records:** leaderboard treatment — mono rank numerals (01, 02…), value in large mono ice, date muted, gold NEW chip, and a thin accent magnitude bar per row (value ÷ column max). Two columns (Gym / Field) as before; a column with no rows collapses.
- **Radar:** same Recharts chart inside a dark panel; accent stroke + soft accent fill; grid/ticks pick up the remapped vars.
- **Program:** panel with a **per-week segmented progress bar** (one segment per week, filled = accent gradient) replacing the plain bar; caption unchanged. Career becomes a timeline list (dot + connector hairline).
- **Badges:** medallions upgraded to metallic gradient rings (bronze/silver/gold via `p-[2px]` gradient wrapper), icons in ice; milestone rows keep the type→icon map.
- **Footer CTA:** stays sticky; becomes a dark glass band (`bg-card/90` + blur + accent hairline) with the same Start Training accent CTA and logo.
- **Print button:** dark glass chip, same behavior.
- **OG image:** refreshed to echo the new look — inset hairline frame, giant translucent initials watermark, larger name. (Satori-safe CSS only.)

## Not doing (YAGNI)

- No new data fields, no share/copy-link UI on the public page, no light/dark toggle, no photo backgrounds (avatar only), no per-sport theming.

## Verification

Targeted: `athlete-profile-card.test.tsx` suite, `npm run build`, plus a live dev-server screenshot pass (mobile + desktop widths) with a minted token before commit.
