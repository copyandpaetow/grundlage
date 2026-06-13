# Part B — Optional `html` compiler (cold-start)

Move `parse()` from runtime to build time for statically-known `html\`...\`` literals,
without changing the public API. Compiled call sites skip the char-by-char parser; the
runtime parser stays as the fallback for uncompiled sites.

**Parked** until [Part A](document-free-parser-plan.md) lands — it is the prerequisite
(document-free `parse()` → a serializable `result` string and no build-time happy-dom).

## Goal (settled)

- **Primary win: cold-start.** Skip the JS state machine on first render of each unique
  template. Bundle tree-shaking is a *nice-to-have, not a requirement* — so this is **not**
  all-or-nothing: partial compilation is fine, and the parser staying in the bundle is
  acceptable.
- **Non-goals.** Steady-state runtime speed (the WeakMap call-site cache already makes
  repeat calls free) and concurrency.

## Shape

- **`htmlCompiled(parsed, ...values)`** — runtime entry that skips `parse()` and the
  WeakMap: `new HTMLTemplate(parsed, values)`.
- **Transform** — an AST pass over `TaggedTemplateExpression` where `tag === "html"` and the
  quasis are static (the `${}` slots stay as runtime args). It invokes the **real**
  `parse()` at build time (never a fork), serializes `ParsedHTML` (`result` — already
  post-suppress, so no DOM round-trip — plus `bindings`, `expressionToBinding`,
  `templateHash`, `hostBindingOffset`; `fragment: null`), hoists it as a module const, and
  emits `htmlCompiled(_tpl, ...originalExpressions)`. Non-static tags are left untouched and
  fall through to runtime `html`.
- **Home:** the existing `prerender-plugin/` (needs refining).

## Build order (de-risked)

1. **Round-trip test first** (the risky bit): `serialize → revive` must be faithful —
   `templateHash` equal, `bindings` deep-equal, and `buildFragment(revived.result)` matches
   `buildFragment(live.result)`. Surfaces anything JSON drops before any transform exists.
2. `htmlCompiled` runtime entry.
3. The transform: match, serialize via the real `parse`, hoist, emit, fall through.
4. Sourcemaps + shape version-stamp.

## Open questions (resolve when unparking)

- **Shape version-lock.** Stamp a schema version into the emitted structure and check it, so
  pre-compiled output from an older library version can't be silently wrong. Biggest
  long-term hazard.
- **Sourcemaps.** A runtime error in a compiled template must point at the user's `html\`\``
  literal, not the hoisted `_tpl0` const.
- **Internal call sites.** Whether to compile the three library `html\`\`` sites
  (`content.ts:32`, `csr-runtime.ts:208`, `ssr-runtime.ts:112`). Optional under the
  cold-start framing; trivial templates, marginal win.
- **Fallthrough diagnostic.** Optional now (was load-bearing only for the abandoned
  all-or-nothing bundle goal); a diagnostic naming skipped literals still helps coverage.
- **Hidden-class stability.** Emit binding object literals in `createBinding` field order so
  V8 assigns the same shape the runtime parser would — or confirm `JSON.parse` insertion
  order already matches.
