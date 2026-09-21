# OpenRouter migration — what moved, what didn't, how to verify

OpenRouter is now the primary provider for every call that goes through the
shared `callAgent`. Direct Anthropic remains as an automatic fallback.

## Live results, 2026-09-21

Run against a real key. **The account is unfunded** ($0 purchased), so the two
passes below ran on a residual free allowance of roughly 800 tokens and anything
larger 402s.

VERIFIED:

- The key authenticates and the slug mapping is right — `anthropic/claude-sonnet-4.6`
  and `anthropic/claude-haiku-4.5` both answered.
- **Forced `tool_choice` works on OpenRouter.** This was the biggest unknown: the
  failure mode is silent (the model answers prose instead of calling the tool)
  and it would have surfaced as a confusing Zod error. It works. ~3.2s for a
  trivial call.
- Structured output parses and passes Zod.
- Usage accounting parses (`tokens=803`).
- **The fallback fires and classifies correctly.** A Fable call 402'd at
  OpenRouter, was recognised as a provider fault, fell back to direct Anthropic
  inside the same call, and Anthropic's own credit 400 was then correctly NOT
  retried. The final error is Anthropic-shaped, which is the proof the fallback
  ran rather than the OpenRouter error being rethrown.

STILL UNVERIFIED — all blocked on the balance, not on the code:

- **Fable 5.1**, which is both the architect and the exercise selector. At
  $10/$50 per MTok it 402s immediately on this balance, so the model that does
  the actual program generation has never run through OpenRouter.
- **Prompt caching / hit rate.** Anthropic only caches prompts above ~1024
  tokens, so it cannot be exercised on a free allowance at all. This is the
  expensive unknown: a 0% hit rate multiplies the cost of every generation.
- A full week generation, and latency against the 450s / 1500s budgets.

**BOTH PROVIDERS ARE CURRENTLY UNFUNDED.** OpenRouter is at $0 and Anthropic
reports "credit balance is too low", so generation fails on both paths right now.
Topping up OpenRouter alone is enough to restore service — the fallback is for
outages, not for funding.

## The switch

`OPENROUTER_API_KEY` is the entire switch.

- **Set** → every `callAgent` goes to OpenRouter, falling back to Anthropic on a
  provider fault (no credit, bad key, 429, 5xx, network).
- **Unset** → everything runs on Anthropic exactly as before. That is the revert.

Fallback is deliberately narrow. A 400 or a 404 is *our* bug and would fail
identically on Anthropic, so those are re-thrown rather than retried — otherwise
every bug costs twice and hides behind a working response. An abort is the
caller's deadline and is never retried.

## Covered: 57 files

Everything that calls `callAgent` — program and week generation, the strategy
agents (chief/SEO/ads/social), blog generation, the bookkeeper. Both runtimes:

| Runtime | File | Transport |
|---|---|---|
| functions | `functions/src/ai/anthropic.ts` | raw OpenAI SDK → OpenRouter |
| app | `lib/ai/anthropic.ts` | raw OpenAI SDK → OpenRouter |

The app path deliberately does **not** use the Vercel AI SDK.
`@ai-sdk/openai-compatible` ships `@ai-sdk/provider` v4 while `@ai-sdk/anthropic`
(what `ai@6` is pinned against) ships v3, so its model object is not assignable
to `LanguageModel`. The package version lines are not aligned across that
ecosystem, and there is no `openai-compatible` release on the v3 provider line —
using it would force an `ai` v6 → v7 upgrade touching every AI feature in the app.

## NOT covered: 14 files still call Anthropic directly

**These keep working today, but they read `ANTHROPIC_API_KEY` and nothing else.
If Anthropic funding stops, these break while everything else keeps running.**
That is the one thing to know before assuming the migration is complete.

```
app/api/admin/marketing/faqs/ai/route.ts
functions/src/image-caption-generation.ts
functions/src/image-vision.ts
functions/src/video-vision.ts
functions/src/lib/hook-suggestion.ts
functions/src/lib/image-alt-text.ts
functions/src/lib/image-quality-judge.ts
lib/ai/hook-suggestion.ts
lib/ai/quote-extraction.ts
lib/ai/tool-loop.ts
lib/blog/content-angle.ts
lib/blog/keyword-proposal.ts
scripts/backfill-exercise-metadata.ts
scripts/enrich-ai-metadata.ts
```

Each builds its own `new Anthropic()` and calls `messages.create` with a bespoke
shape — mostly vision work (images, video frames) plus one agentic tool loop.
They were left alone because converting fourteen bespoke multimodal call sites
with no key to test against trades a working feature for an unverified one,
fourteen times over. They are mechanical to convert once a key exists.

Also still on Anthropic: `streamChat` / `streamAgent` in `lib/ai/anthropic.ts`.
Those stream to the browser through the AI SDK and are blocked by the same
provider-version conflict.

## Model mapping

OpenRouter uses dots where Anthropic uses dashes, and drops dated suffixes.
Verified against `https://openrouter.ai/api/v1/models` on 2026-09-21.

| Anthropic | OpenRouter |
|---|---|
| `claude-opus-4-6` | `anthropic/claude-opus-4.6` |
| `claude-opus-4-8` | `anthropic/claude-opus-4.8` |
| `claude-opus-5` | `anthropic/claude-opus-5` |
| `claude-sonnet-4-6` | `anthropic/claude-sonnet-4.6` |
| `claude-sonnet-5` | `anthropic/claude-sonnet-5` |
| `claude-haiku-4-5-20251001` | `anthropic/claude-haiku-4.5` |
| `claude-fable-5-1` | `anthropic/claude-fable-5.1` |

An unmapped id **throws** rather than passing through. A passthrough would 404 at
OpenRouter, the fallback would read that as a provider fault, and every call
would quietly be served by Anthropic — a migration that looks done while nothing
has moved.

## Deploying

1. `firebase functions:secrets:set OPENROUTER_API_KEY`
2. Set `OPENROUTER_API_KEY` in Vercel.
3. Deploy functions, then the app.

The secret is declared AND bound into `allSecrets` in `functions/src/index.ts`.
That binding is load-bearing: a declared-but-unbound secret is simply absent from
`process.env` inside the function, so `isOpenRouterConfigured()` would read false
and every call would silently go to Anthropic.

## Verification checklist — run these first

Set the key locally, then:

```bash
npx tsx scripts/probe-week-generation.ts openrouter-smoke --week 3 --override NONE
```

1. **Did it use OpenRouter at all?** The log prints the model per call. If you
   see `falling back to direct Anthropic`, read the reason — a 401/402 means the
   key; anything else is worth understanding before trusting the path.
2. **Did tool calling work?** A `No structured_output tool call in OpenRouter
   response` error means forced tool choice did not take. Fix: flip that model to
   the `response_format` branch (`modelRejectsForcedToolChoice`).
3. **Did caching survive?** The orchestrator logs `Cache stats — writes/reads/hit
   rate` at the end. On a second identical run the hit rate should be well above
   zero. **If it is 0%, the cost of every generation has gone up several-fold** —
   the selector sends a multi-KB cached prefix, and that saving is the difference
   between a cheap retry and an expensive one.
4. **Did Fable work?** It is the architect and the selector. Anthropic 400s on
   forced tool choice for that family; OpenRouter normalizes, so it may behave
   differently in either direction. Watch for refusals arriving as HTTP 200.
5. **Latency against the budgets.** Four Fable week-3 runs took 155–239s direct.
   OpenRouter adds a hop. If that pushes past 450s the Eventarc path starts
   failing — see `docs/handoff/2026-09-21-cloud-tasks-generation.md`.
6. **Schema constraints.** Anthropic's structured-outputs endpoint rejects
   `minItems`/`maxItems` and silently empties `z.record()` fields; that is why
   the app path forces tool-based JSON. If OpenRouter constrain-decodes the same
   way, expect empty objects in action args and recommendation payloads rather
   than an error.
