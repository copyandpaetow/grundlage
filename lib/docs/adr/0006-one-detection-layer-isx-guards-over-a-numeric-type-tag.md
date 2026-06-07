# One detection layer: `isX()` guards over a numeric type tag, not `instanceof`

Our own value-types are detected through a single consistent guard layer — one `isX(value)`
function per type (`isTemplate`, and `isCssTemplate` when css\`\` lands) — backed by a
numeric kind tag drawn from one per-domain map (the `BINDING_TYPES` / `ATTRIBUTE_SHAPE`
pattern). We do **not** discriminate our own types with `instanceof`. This is Rule 4 in
`CONVENTIONS.md`; this ADR records why, and what it deliberately leaves open.

## Considered Options

- **`isX()` guard over a numeric tag (chosen).** A value we own carries a kind number from
  a single map; `isTemplate(v)` reads it. Every site that needs "is this one of ours, and
  which?" calls the same guard.
- **`instanceof` (rejected).** What the code does today — `value instanceof HTMLTemplate`
  at nine sites.

## Why

- **`instanceof` breaks under double-bundling.** A library on npm can end up with two
  copies loaded (two bundlers, two versions, a dependency that vendored its own copy). Two
  `HTMLTemplate` constructors means `a instanceof B` is `false` for a genuine template, and
  every check that asks "is this expression a template or a plain user value?"
  (`content.ts` `toTemplateList`, hashing, the CSR/SSR runtimes) silently takes the wrong
  branch. A tag check survives that.
- **Consistency is the goal, weighted heavily.** There should be exactly one way to ask
  "what kind of thing is this?" for our types — one guard per type, used everywhere, with
  the fragile or multi-step part of the check written once. Scattering `instanceof`
  (or any ad-hoc probe) across call sites is the failure mode this rule exists to prevent.
- **It decouples identity from representation.** Once internal stateful types are structs
  rather than classes (ADR-0005) there is no constructor to `instanceof` against, so a guard
  reading a stored tag is the only option that still works — the two decisions reinforce
  each other.

This is the *detection* (read) side. It pairs with the *storage* side (Rule 15: classify
once, store the kind number, read it downstream) and the *dispatch* side (Rule 8: route the
stored kind through one table). Detection produces the number; storage caches it; dispatch
consumes it — three moments, no redundancy. Hot paths read the stored kind and the dispatch
table; they do not call `isX` in a loop.

## Consequences

- The nine `instanceof HTMLTemplate` sites collapse to `isTemplate(v)`. `CSSTemplate` (css\`\`)
  will use the same layer from the start.
- The kind is a number from one per-domain map. *How* that number is carried — a field under
  a plain key vs. a field under a shared symbol key, a value on the object vs. a parallel
  array — is an implementation detail left to the code and the compute-vs-memory call under
  the preface; it is intentionally **not** fixed here, so this decision does not go stale
  when the storage is refactored.
- **Left open on purpose:** whether platform / primitive types also get guards
  (`isString`, `isPromise`, …) or stay inline `typeof` / `instanceof`. Because detection is
  centralized (Rule 15), there may be too few raw-detection sites left for primitive
  wrappers to earn their keep — but that is clearer after the Rule 15 storage work lands.
  Re-evaluate then; this ADR governs *our own* types only.
