# Part A — Document-free parser

Make `parse()` touch no DOM, so it can run at build time (the [html compiler](html-compiler-plan.md))
and without happy-dom on the SSR parse path. This is the foundation Part B depends on, and
it folds cleanly into the ongoing parser refactor.

Decisions are recorded in **ADR-0009** (parser is a pooled struct) and **ADR-0010**
(document-free parser). This file is the disposable how.

## What changes

- **No public API change.** `html\`...\``is identical.`ParsedHTML`gains`result: string`and`fragment`becomes`DocumentFragment | null`.
- **Parser state → struct.** `ParserState` interface, `createParser()`, `resetParser()`,
  context-first free functions (`parse(parser, …)`, `capture(parser, …)`,
  `completeTag(parser)`, …). One module-scope pooled instance, reset per parse. Everything
  on `ctx` (per-char cursors included); the state machine body is otherwise unchanged.
- **Tail change.** Stop building the fragment in `parse()`. Return `result` (the
  `resultBuffer.join("")` string) with `fragment: null`.
- **Materialization moves to the consumer.** `parserHost` (the module `<template>`) and the
  `innerHTML`→fragment block leave `parser/html.ts` for the rendering layer as
  `buildFragment(result)`. First `setup()` builds it and caches on the shared
  `ParsedHTML.fragment`; later instances clone.
- **Root-template detection moves into parse-state.** Disqualify a candidate root on (1) a
  second top-level element or (2) non-whitespace top-level text (before or after), tracked
  via `openTagBindings.length` (depth) + `hasOpenedAnyTag`. Keep the `parse(parser, strings,
true)` reparse as the correction, flag-driven at the tail, reusing the pooled instance.
- **Confirmed-root unwrap → wrapper suppression.** While `isRootTemplate` is the optimistic
  state, never emit the `<template>` open/close into `elementBuffer`/`result`. Confirmed
  root reaches the tail wrapper-free; a disqualified one reparses with `force` and emits
  normally.

## Steps (de-risked, simple → complex)

1. **Struct extraction (mechanical).** Move the module `let`/`const` state and nine buffers
   into a `ParserState` struct; `createParser`/`resetParser`; thread `parser` as the
   first param through every helper. No behavior change. **Gate: `npm run bench:compare`
   against `bench/baseline.json` — watch `html.bench.ts > parsing (cold)`** (the group that
   bypasses the WeakMap with a fresh `TemplateStringsArray` per iteration, so it isolates
   the per-char cursor cost). The `parsing - cached` group is the control: it should _not_
   move; if it does, the refactor leaked into the hot render path. If a hot cursor regresses
   past noise, hoist only that cursor to a loop local (ADR-0009 escalation).
2. **Tail + materialization split.** `parse()` returns `result` + `fragment: null`. Add
   `buildFragment` in the rendering layer (carries `parserHost`). `setup()`/`hydrate()`
   build lazily on first use and cache on `ParsedHTML.fragment`. Runtime behavior identical;
   verify the full `*.dom.test.ts` + `*.browser.test.ts` parser/rendering suites pass.
   **Bench note:** this step _relocates_ the `innerHTML`→fragment work from `parse()` into
   first `setup()`. Expect `html.bench.ts > parsing (cold)` to get _faster_ and
   `template-setup.bench.ts` to absorb the materialization cost — that shift is the work
   moving, **not** a regression. Read the two together; net first-render cost should be flat.
3. **Root-template detection in-parser.** Add the disqualify checks + wrapper suppression +
   flag-driven tail reparse. **Delete** the DOM sibling-walk (`html.ts:676–694`).
   **Oracle: `html-root-template.dom.test.ts` must pass unchanged.** Cross-check the
   leading-text, trailing-text, comment-sibling, nested-template, and dynamic-first-tag
   cases explicitly.
4. **Docs.** Convention #1 reworded (done); move the non-reentrancy comment onto the pooled
   instance (replaces the standalone "Rule 1: add non-reentrancy comments" TODO);
   ADR-0009/0010 landed.

## Out of scope

- Rewiring SSR to drop happy-dom from the render path — Part A only decouples _parse_.
  Materialization still uses the DOM; string-based SSR is a later consumer of this seam.
- The compiler itself (Part B).
