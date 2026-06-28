# Entry point returns a constructor instead of registering the element

The `component(generator)` factory returns a `CustomElementConstructor`; the caller
registers it with `customElements.define`. We deliberately do **not** fold registration
into the factory (no `component(name, generator)` that defines as a side effect), even
though that would be one fewer call and is the more "DX-friendly" looking option.

## Considered Options

- **Return a constructor (chosen).** The caller writes
  `customElements.define("my-thing", component(function* (host) {…}))`.
- **Auto-register.** `component("my-thing", function* (host) {…})` defines and registers
  in one call.

## Why

`customElements.define` is the single most vanilla part of the web-components platform,
and it is _not_ one of the pain points the library exists to hide (those are
attribute-vs-property handling, manual DOM updates, and lifecycle). Hiding it buys almost
nothing and costs real capability:

- conditional / lazy / deferred registration;
- scoped or polyfilled custom-element registries;
- registering one definition under multiple names;
- `extends` on the returned class as a deliberate escape hatch — authoring extra public
  methods doesn't fit the library's functional style, but we shouldn't forbid users who
  need it.

Keeping the factory a _pure_ function with no name argument and no side effect is also the
smaller, more honest primitive. The auto-registering form, if ever wanted, is a three-line
userland helper and does not belong in the core surface.

## Consequences

The library never owns element names; every consumer touches `customElements.define`
directly. This is intended — it keeps the platform visible rather than abstracted away.
