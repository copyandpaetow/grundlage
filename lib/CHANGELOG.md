# Changelog

## 0.8.0

### Breaking

- **Generator signature.** `function* (host)` → `function* ({ host, …props })`. Render functions and
  inner generators receive the same object.
- **The schema** needs to be declared from the options `component(gen, { props })`.
  `component(someGenerator)` no longer inherits props from that generator.
  - The standalone function `props(element, schema)` can still be used for elements in general

### Types

- **A yielded render function types its parameter.** `yield ({ label }) => …` was an implicit `any`
  under `strict`, because `ComponentGenerator` returned a bare `Generator`. Its yield type is now
  `YieldableValue<DeclaredSchema>`, a union carrying exactly one call signature, so TypeScript has a
  contextual signature to hand the arrow. Nested generators yielded from the body get it too.
  - A `yield*` helper that annotates its own return type spells it `Generator<YieldableValue>`, not
    bare `Generator`. Inferred return types need no change.
  - `YieldableValue` is exported.
- **The return position is typed and named.** It was `any` under the bare `Generator`, so a wrong
  return neither autocompleted nor errored. It is now `Cleanup | void`, with `Cleanup` exported and
  named rather than spelled `VoidFunction`: the hover is the one place the teardown announces itself.

### Added

- **A return that is neither a function nor `undefined` warns.** The runtime drops it — the return
  position is the cleanup function — and the drop used to be silent for anyone not running the types.

### Fixed

- **A hole inside an event name is no longer dropped.** `on${eventName}=${handler}` and
  `on-${suffix}=${handler}` bound an attribute literally named `on` and discarded the hole. Both
  now compose the name and bind the event it spells, native and custom alike.
- **A composed event name binds a listener, not an IDL property.** `<button ${"onclick"}=${fn}>`
  assigned `element.onclick` while the literal spelling used `addEventListener`. Every attribute
  lane now resolves the name the same way.
