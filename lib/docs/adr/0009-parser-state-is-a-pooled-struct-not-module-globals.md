# Parser state is a single pooled struct, reset between runs

The HTML parser held its state machine, cursors, and nine buffers as loose module-scope
`let`s/`const`s — blessed by Convention #1's exception. We moved that state into a
`ParserState` struct (typed by `interface`, built by `createParser`, cleared by
`resetParser`) operated on by context-first free functions, keeping a **single** pooled
instance at module scope that we `reset` between parses instead of reallocating.

## Why

Convention #1 / Rule 3 / ADR-0005 want stateful things as structs + free functions, not
loose globals and not a `class`. The parser was the lone holdout, exempted purely for
performance: per-call allocation of nine buffers on a render-time path is real GC
pressure. A single pooled-and-reset struct keeps that allocation profile — zero per-parse
allocation — while adopting the struct shape, so the exemption no longer has to mean "raw
module globals."

The cost is that the per-char hot cursors (`state`, `charIndex`, `splitIndex`,
`activeTemplate`) become property loads on the pooled struct instead of module locals. We
accepted that (everything on `ctx`) because `parse()` runs **once per call-site**
(WeakMap-cached) and the planned html compiler removes it from the runtime entirely, so the
regression is paid once per unique template and is dwarfed by the `innerHTML`
materialization that follows. The change is gated on `html.bench.ts` vs
`bench/baseline.json` per ADR-0007; if a hot cursor shows up in the compare, only that
cursor is hoisted back to a loop local.

## Considered Options

- **Single pooled struct, all state on `ctx` (chosen).** Struct shape, zero per-parse
  allocation, mechanical diff. Per-char property loads, bench-gated.
- **Keep loose module globals (rejected).** The status quo. Rejected: it's the only
  Rule-3 holdout, and the exemption was never about _loose_ state — only about avoiding
  per-call allocation, which a pooled struct also achieves.
- **Allocate a `ParserState` per `parse()` (rejected).** Cleanest reentrancy story, but
  re-allocates and re-grows nine buffers every parse on a render-time path. Rejected on GC
  pressure — the exact thing the original exemption protected.
- **Hoist hot cursors to loop locals, sync at helper boundaries (deferred).** Zero
  per-char regression, but threads cursors through ~8 helpers and breaks "the state
  machine stays mostly as is." Held as the escalation if the bench regresses.

## Consequences

- Convention #1's parser exception is reworded: a pooled struct instance, not module
  globals.
- The `parse(strings, true)` reparse still reuses the single pooled instance; it stays
  safe by the same property as before — the outer call reads nothing after the recursive
  `return`. The non-reentrancy comment moves onto the pooled instance.
