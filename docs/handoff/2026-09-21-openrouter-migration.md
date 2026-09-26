# OpenRouter migration — what moved, what didn't, how to verify

OpenRouter is now the primary provider for every call that goes through the
shared `callAgent`. Direct Anthropic remains as an automatic fallback.

## Live results, 2026-09-21 — VERIFIED END TO END

Run against a funded key. A full week generation completed on OpenRouter with no
fallback, and the travel-equipment feature was intact: 23 slots, **zero**
requiring equipment. Cost $1.29 for the generation.

| Check | Result |
|---|---|
| Key + slug mapping | PASS |
| Forced `tool_choice` — sonnet-4.6 / haiku-4.5 / opus-4.6 | PASS, ~3-4s each |
| Fable 5.1 via `response_format` | PASS, 5.9s |
| Fable 5.1 via forced `tool_choice` | **400** — see below |
| Prompt caching passes through | **PASS** |
| Fallback classification | PASS |
| Full week generation | PASS — 23 exercises, 0 warnings, no fallback |
| Equipment constraint honoured | PASS — 0 of 23 slots need equipment |

### Fable still refuses forced tool choice

OpenRouter does NOT normalize this away — it relays the provider's 400
("Provider returned error"). The per-model split in `modelRejectsForcedToolChoice`
is therefore load-bearing on this path too, not an Anthropic-only quirk to tidy
away: delete it and every architect AND selector call 400s, because both run on
Fable. That 400 correctly does not trigger the Anthropic fallback (it is a
malformed request, not an outage) and is unreachable in practice because the
split routes Fable to `response_format`.

### Caching works — measured, not assumed

Two identical calls with a ~35k-token cached prefix, seconds apart:

    call 1:  cacheWRITE=35763  cacheREAD=0
    call 2:  cacheWRITE=0      cacheREAD=35763

`cache_control` reaches Anthropic through OpenRouter and `normalizeUsage` reads
the counters correctly.

**The week run reported a 0.0% hit rate, and that is NOT a caching failure.**
The comparable direct-Anthropic run reported 0.0% too (37,206 writes / 0 reads);
only the multi-pass run reached 34.9%. Within a single selector pass there is
nothing to re-read. Do not "fix" a 0% on a single-pass run.

### Latency — the one number that got worse

Same request, same prior-week history, same target week:

    direct Anthropic   239.2s
    via OpenRouter     288.7s     (+49.5s, ~21%)

Still inside the 450s Eventarc budget, but the margin narrowed. This matters for
the unresolved week-4 failure at exactly 450.0s: OpenRouter's extra hop makes a
deep week MORE likely to exceed it, which is an independent argument for the
Cloud Tasks migration (1800s ceiling, 1500s budget) in
`docs/handoff/2026-09-21-cloud-tasks-generation.md`.

Token usage was also higher on this run — architect 18,915 / selector 44,576,
against 13,356 / 14,306 on the direct run. One run each, different jitter seeds,
so treat it as an observation to watch rather than a measured regression.

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

## Coverage: complete

Every production call site now goes through OpenRouter with Anthropic as the
fallback. `grep -rn "new Anthropic(" lib app functions/src scripts` returns only
the four provider-layer files, and those ARE the fallback implementation.

Two layers, both with twins:

| Layer | Used by | Covers |
|---|---|---|
| `callAgent` | 57 files | program/week generation, strategy agents, blog, bookkeeper |
| `createMessageCompat` | 14 files | vision, captions, alt-text, quality judge, hooks, quotes, blog helpers, the FAQ route, the agentic tool loop, 2 scripts |

`createMessageCompat` is a drop-in for `client.messages.create`: same params in,
Anthropic-shaped message out. That kept each conversion to a one-line edit with
the downstream handling untouched, instead of fourteen chances to change
behaviour by accident in code that already worked. It speaks tools in both
directions, because two scripts use forced tool choice as structured output and
`lib/ai/tool-loop.ts` is a real agentic loop that feeds `tool_use` blocks back in
as `tool_result`.

The old `if (!process.env.ANTHROPIC_API_KEY) throw` guards were REMOVED, not
kept. They became wrong the moment OpenRouter became primary — an OpenRouter-only
deployment is now the expected configuration, and those guards would have
rejected it while the provider sat there working. `assertModelProvider()` accepts
either key.

### Verified live, 2026-09-21

Every converted shape, against the real provider:

    text            1.8s   -> "converted"
    image           2.1s   -> "Black DJI logo on white background."   (read a real PNG)
    forced tool     2.8s   -> {"pattern":"squat","is_compound":true}  stop=tool_use
    tool_result     1.3s   -> coherent follow-up after a tool round-trip

### Still on Anthropic, deliberately

`streamChat` / `streamAgent` in `lib/ai/anthropic.ts`. They stream to the browser
through the Vercel AI SDK, and are blocked by the provider-version conflict
described above — not by anything about OpenRouter itself.

**Superseded 2026-09-26.** `streamAgent` (the AI page builder) now streams from
OpenRouter through `lib/ai/openrouter-object-stream.ts`, which uses the raw
OpenAI SDK and so never meets the provider-version conflict; direct Anthropic is
only its pre-first-part fallback. `streamChat`, `getClient` and the
`export { Anthropic }` re-export were deleted from `lib/ai/anthropic.ts` the same
day: none had a caller, and each was a ready-made way to wire a new
direct-Anthropic call back in.

### Tests

Four suites had to move with the transport:

- `hook-suggestion` / `quote-extraction` mocked `@anthropic-ai/sdk`; they now mock
  `createMessageCompat`. Every assertion survived unchanged, which is the shim's
  contract holding.
- `anthropic-images` / `anthropic-schema` assert the AI SDK request shape
  (jsonTool, cached system block, image ordering). callAgent now prefers
  OpenRouter, so with a key set `generateObject` is never reached and those mocks
  would never fire. They now clear `OPENROUTER_API_KEY` to select the fallback
  path they actually describe, and say so at the top. The equivalent guarantees
  on the PRIMARY path are covered by `__tests__/lib/ai/openrouter-request.test.ts`.

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
