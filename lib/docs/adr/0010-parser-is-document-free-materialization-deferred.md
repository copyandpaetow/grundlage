# The parser is document-free; fragment materialization is deferred to the consumer

`parse()` no longer touches the DOM. It returns a `result` **string seed** plus bindings,
hash, and offsets; building the `DocumentFragment` (`innerHTML` → fragment) moves out of
`parser/html.ts` into the rendering layer (`buildFragment`), run lazily on first `setup()`
and cached on the shared `ParsedHTML`. Root-template detection — previously done by
inspecting the built fragment's siblings — moves into the parser's own state.

## Why

The parser's only DOM dependencies were materialization and the root-template
detection/unwrap. Removing them lets `parse()` run at build time with no DOM (the
prerequisite for the html compiler, see [the compiler plan](../plans/html-compiler-plan.md)) and
lets SSR parse templates without standing up happy-dom on the parse path. The string
parser is also the more authoritative source for root-template structure than a
re-normalized `innerHTML` round-trip — it already tracks raw-content, nesting depth, and
self-closing exactly.

Root-template detection becomes a parse-state check: a root template is the first element
and the only top-level node except comments and whitespace-only text, so the parser
disqualifies on (1) a second top-level element or (2) non-whitespace top-level text
(before or after). Erring toward _not-root_ is the safe direction — a false not-root
renders the same content without lifting host attributes, whereas a false root would have
to invent a top-level node the parser never saw, which inside a `<template>` is
near-impossible. The existing `parse(strings, true)` reparse stays as the correction, now
flag-driven at the tail. The confirmed-root unwrap is achieved by **suppressing** the
`<template>` wrapper emission during the optimistic root pass, rather than stripping it
from a built fragment afterward.

## Considered Options

- **Document-free parse, materialize in the consumer (chosen).**
- **Keep the DOM round-trip, run happy-dom at build time too (rejected).** Less work, but
  leaves SSR's parse path DOM-coupled, forecloses string-based SSR, and adds a heavy build
  dependency for what is pure string work.
- **Detect root templates in-parser but still unwrap via a built fragment (rejected).**
  Not actually document-free — defeats the purpose.

## Consequences

- `ParsedHTML` gains `result: string`, and `fragment` becomes `DocumentFragment | null`
  (null until first materialization). The string seed is retained (not freed) because the
  compiler and SSR reuse it.
- `parserHost` (the module-scope `<template>`) and the `innerHTML`→fragment block live in
  the rendering layer now, not the parser.
- The compiler can serialize `result` directly — no build-time DOM round-trip — because
  wrapper-suppression bakes the unwrap into the string.
- First render of each template pays the `innerHTML` materialization in `setup()` instead
  of in `parse()`; steady-state is unchanged (the same single fragment, cloned per
  instance).
