# Dynamic CSS via custom-property value-indirection

A `<style>` (or inline `style`) with a dynamic hole keeps its sheet/declaration **static**
and routes each dynamic _value_ through a CSS custom property updated per-instance with
`setProperty` — instead of re-serializing the whole `textContent` each frame. The static
sheet uses `var(--cN, <initial>)`; the per-instance value lands on the component host via
`host.style.setProperty("--cN", value)`. Full design and implementation steps live in
`docs/css-value-indirection-plan.md`; this ADR records the decision and the roads not taken.

## Why

The reparse _is_ the bug. Measured in the cube editor: a per-frame hole that re-serializes
~150 lines of `<style>` runs at 20–30fps; the render channel itself is free (microtask
batching makes it net-positive), and a static sheet + `setProperty` runs at 100–110fps. So
the entire penalty is the browser re-tokenizing the sheet every frame. Custom-property
invalidation is the platform's _designed_ primitive for dynamic values — browsers optimize
it specifically, and the whole ecosystem converged here (Lit, Stencil, FAST,
vanilla-extract, styled-components/Emotion).

This is a **fail-safe enhancer over an always-correct fallback**: any hole the analyzer
can't classify as a value falls back to today's `textContent` rebuild. CSS evolving under us
costs at worst a missed optimization, never a correctness bug. It also honors ADR-0004:
`update()` stays the only writer — this changes _how_ a dirty binding applies, not _who_
triggers it.

## Scope: only the value slot is fast

CSS has several slots that could be dynamic: **values, property names (keys), selectors,
at-rule preludes, and whole stylesheets**. This decision makes only the **value** slot fast
— the common per-frame case (transforms, colors, positions). Holes in the other slots
(property names on descendants, selectors, at-rule preludes, an opaque whole-stylesheet
hole) are classified `structural` and **fall back to the reparse path**.

A truly dynamic, composable CSS system would manage all of those slots. Doing so is
genuinely complex (selector/key/stylesheet composition, scoping, dedup) and far less common
than dynamic values, so it is deliberately out of scope, kept correct by the fallback. "Fast
CSS" here means "fast dynamic _values_," not "all dynamic CSS."

## Considered Options

- **Re-serialize `textContent` (status quo, rejected as the mechanism — kept as the
  fallback).** It _is_ the measured bug. Retained only as the always-correct path for
  structural holes.
- **Rule-index CSSOM mutation (deferred, demoted).** The "thorough" approach: mutate
  individual `CSSRule`s in the CSSOM. It has no real prior art, is fail-unsafe (CSSOM
  indices drift as the sheet changes), and is a strict _superset_ of this work — it needs the
  same analyzer/plan/dirty-diff and only _adds_ span machinery. If ever built, it would
  handle only the _structural_ holes that currently fall back, riding the same analyzer —
  additive, never a replacement for the value path.
- **`adoptedStyleSheets` / constructable stylesheets (set aside — not a true alternative to
  the core).** A constructable sheet is **shared across all instances**, so it can carry only
  the _static_ sheet; per-instance values differ between instances and would _still_ require
  the same custom-property indirection set per-instance on the host. So it never replaces
  this decision — at best it's a future substrate for the static text, layered on top.
  Independently, it has no declarative HTML form, so zero-JS SSR can't deliver it without
  shipping JS. Either reason alone parks it; together they mean value-indirection is needed
  regardless of whether constructable stylesheets are ever adopted.

## Consequences

- **The carrier is the component host.** Custom properties are set on the host so `var()`
  inherits through the shadow boundary to wherever the selector matches — we can't
  `setProperty` on a selector's (unknown) matched descendants. Resolved once at setup as
  `styleEl.getRootNode().host`.
- **Light-DOM / top-level use degrades to the fallback.** If `getRootNode()` is the document,
  there is no host carrier → that binding takes the `textContent` path. The library targets
  shadow roots; this is the honest degenerate path, not an error.
- **`css\`\`` composition is a separate, later concern.** v1 is shaped so a future `css\`\``
  (splicing one stylesheet into another) is additive, but that is about _composition_ of
  stylesheets, not about this value-hole core. See the plan doc's forward-compat commitments.
- This is the **permanent** mechanism for value holes, not scaffolding. The forward-compat
  hedging in the plan concerns structural holes and `css\`\``, not the value path.
