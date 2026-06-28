# Internal stateful types are structs operated on by free functions, not classes

Stateful things we own (e.g. `HTMLTemplate`) are plain structs created by a `createX`
factory and operated on by free functions whose first argument is the struct — not
`class` instances with methods. The only classes in the codebase are the ones the
platform forces: the generated element class and `FormBase`, both of which must
`extends HTMLElement`. This is Rule 3 in `CONVENTIONS.md`; this ADR records why.

## Considered Options

- **Structs + free functions (chosen).** `createTemplate(...)` returns a typed struct;
  `setupTemplate(template, host)`, `updateTemplate(template)` etc. are module-level
  functions. State lives in the struct (Rule 1); the lifecycle pair lives in one module
  (Rule 6).
- **Classes for internal types (rejected).** `HTMLTemplate` stays a `class` with
  `setup()`/`#flush()`/`get hash()` and private fields. This is what the code looks like
  today and what a web-components author would reach for by default, since the platform
  surface _is_ classes.

## Why

The intuition that classes are faster here does not hold, and the things that actually
matter pull the other way:

- **No perf win to give up.** V8 gives a struct built by a factory the same stable hidden
  class and the same monomorphic field access a class instance gets, _provided the factory
  always initializes the same fields in the same order_ — which we already engineer for
  (`html.ts` initializes attribute shape to `STATIC` from the start "so the object's hidden
  class is stable"). Free functions live at module scope and are shared across all structs,
  exactly like prototype methods — no per-instance allocation either way. So choosing
  structs costs nothing at the engine level.
- **It composes with how the rest of the library is already written.** Everything outside
  `HTMLTemplate` is already structs + free functions; the dispatch-table style (Rule 8) and
  the `context`-first function shape are uniform. One lone class is the inconsistency, not
  the norm.
- **It removes the dependence on `instanceof` for our own types.** A class invites
  `value instanceof HTMLTemplate`, which is fragile across realms / double-bundling (see
  ADR-0006). Making the type a struct means there is no constructor to test against, so the
  brand-based guard becomes the only option — which is the behavior we want anyway.

The platform exception is deliberate and narrow: where the platform demands a class
(`extends HTMLElement`), we use one and comment that it is platform-forced.

## Consequences

- `HTMLTemplate` converts to a struct + `createTemplate`/`setupTemplate`/`updateTemplate`
  free functions; `#hash` becomes a nullable field; the lazy `get hash()` becomes a
  function that memoizes into that field. This is tracked in the Phase 3 refactor.
- A future contributor tempted to "make it a class again for speed" should find this note
  first: there is no measured speedup to gain, and doing so reintroduces the `instanceof`
  realm hazard.
- This ADR is _not_ a ban on the generated element class or `FormBase` — those are the
  recorded platform exception.
