# Changelog

## 0.9.0

### Breaking

- A component yields a template, an update generator, a promise or a `load()`; anything else throws.
- Render functions are removed: `` yield () => html`…` `` → ``yield function* view() { yield html`…`; }``.
- `async function*` and `await` are removed: `await promise` → `yield promise`.
- A `yield` of an update generator waits for its run and evaluates to the run's return value.
- The build targets ES2025: Chrome 122, Firefox 131, Safari 18.4.
- `load` runs with the star and takes no host: `yield load(host, fetcher)` → `yield* load(fetcher)`, keyed `yield* load("key", fetcher)`.
- `load`'s `skipSSR` option and the `LoadOptions` type are removed.

### Types

- `YieldableValue` is `Template | Promise<unknown> | UpdateGenerator` or a `load()` request; `UpdateGenerator` is exported.
- `yield* load(…)` evaluates to the fetcher's awaited type.
- A waited value is `any`; annotate it: `const user: User = yield fetchUser(id)`.

### Added

- An iterator in a content hole paints as a list.
- A `load` result JSON cannot carry (a `Date`, a class instance, a template) throws and names the fix.
- A `load` key used twice in one element throws on the server.
- A yielded generator object, such as `yield load(…)` without the star, throws and names the fix.
- On the server, a run waiting on a promise dispatches the webcomponents-cg `pending-task` event.
- On the server, a cancelable `grundlage-render` event precedes a component's first run; cancelling it leaves the component unstarted.

### Changed

- A paint error throws at the `yield html` that painted it.
- A torn-down generator runs its `finally` block to the end.
- Messages say update or paint where they said render; a fatal error shows `<tag> stopped running.`
- The browser reuses a server `load` result only while hydrating, and runs the fetcher everywhere else.
- A `load` the server failed runs again in the browser, and the loads after it keep their order.
- Unused server `load` results are removed at hydration, and only unkeyed ones warn.

### Fixed

- On the server, a body that catches an update generator's error runs its `finally`, also when that generator called `update()`.
- An `update()` queued for an update generator the body drops settles with the drop instead of re-running the next one.
- A child moved straight after its parent's paint runs its update generator once.

## 0.8.0

### Breaking

- **Generator signature.** `function* (host)` → `function* ({ host, …props })`. Render functions and
  inner generators receive the same object.
- **The schema** needs to be declared from the options `component(gen, { props })`.
  `component(someGenerator)` no longer inherits props from that generator.
  - The standalone function `props(element, schema)` can still be used for elements in general
- **`load()` option `skipSsr` → `skipSSR`.** Acronyms keep their capitals inside a name. TypeScript
  flags the old spelling; in plain JavaScript it is ignored and the load replays again.

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

- **`grundlage-error` event.** A fatal error empties the component and dispatches a cancelable
  `ComponentErrorEvent` carrying `error` and `tagName`. `preventDefault()` skips the console line
  and the error text, so an app can render its own fallback.
- **Development build.** Warnings ship only in `dist/development/`, selected by the `development`
  export condition. The default build strips them (1,061 bytes minified).
- **A block element inside `<p>` warns.** The DOM accepts a `<div>` or `<h2>` inside a `<p>`, the
  HTML parser closes the `<p>` before it, so server-rendered markup hydrated into a different tree
  than the client rendered. A dynamic tag or a nested template that puts one there now warns in the
  development build, unless a `<button>`, `<table>` or similar ends the paragraph's scope first.

### Changed

- **Live state follows the binding after the first render.** `value` (input, textarea),
  `checked`, `indeterminate` and `selected` were always written as attributes, which only set the
  default once the user had interacted, so a state change stopped showing. The first commit still
  writes the attribute (for a textarea, its text); every later one writes the property. Absence
  empties the shown value and keeps the default. `<select value=${…}>` warns and selects nothing:
  bind `selected` on the option.

- **A fatal error logs `console.error` naming the tag,** not `console.warn`.
- **A throwing cleanup or a rejected async `return()` goes to `reportError`,** so `window.onerror`
  trackers see it. Without `reportError` (Node) it falls back to `console.error`.

- **A host binding writing the component's own declared prop re-renders.** It was output only and
  scheduled nothing, so a value both bound on the host `<template>` and painted from the prop
  showed one render behind, and a binding derived from the prop itself (`count=${count + 1}`)
  silently counted renders. A changed value now re-renders once and settles; a self-derived one
  ends in the runaway-render error. The server converges the same way before it ends the run, so
  a re-render asked for during the server paint is no longer dropped.

- **A return that is neither a function nor `undefined` warns.** The runtime drops it — the return
  position is the cleanup function — and the drop used to be silent for anyone not running the types.

- **`/>` after an unquoted attribute value ends the tag.** HTML reads the slash into the value, so
  `<rect width=${w}/>` set `width="2/"`. The slash now closes the element, the way SVG markup
  means it. A slash followed by anything else stays in the value: `href=${base}/intro` is
  unchanged, `href=${base}/>` no longer appends the `/`.

### Fixed

- **A custom property updated to a CSS-wide keyword takes its effect.** A style hole's update
  passed the whitespace after the colon into `setProperty`, and a custom property keeps it:
  `--x: ${"initial"}` stored the literal token `" initial"` instead of the keyword, so a `var()`
  fallback never applied. The first render was unaffected, since it writes sheet text.
- **A dynamic tag inside `<p>` no longer breaks the component.** Its placeholder was a `<div>`,
  which closes an open `<p>`, so even `<p>…<${"span"}>…</${"span"}></p>` failed with an invariant
  error and an empty shadow root. The placeholder is now an unknown hyphenated element, which the
  parser leaves inside the paragraph.
- **A dynamic tag the HTML parser relocates ends the component with a remedy.** `<${"tr"}>` inside
  `<tbody>` was moved in front of the table, which rendered an empty element there and a row the
  browser invented. Any dynamic tag that no longer sits where it was written is now a fatal error
  naming the fix: write that tag statically.
- **Templates inside `<svg>` and `<math>` mount in their namespace.** A nested template or list row
  was parsed as HTML, so ``<svg>${rows.map((row) => html`<circle …>`)}</svg>`` mounted invisible
  HTML `<circle>` elements. A template is now parsed in the namespace of the position it mounts into,
  and `<foreignObject>` or `<mi>` switch back to HTML as the parser does.
- **A dynamic tag inside `<svg>` or `<math>` keeps its namespace and case.** `<${"linearGradient"}>`
  created an HTML `<lineargradient>`. A dynamic tag that would become `<svg>` or `<math>` inside
  HTML throws instead, since its children were already parsed as HTML: write that tag statically.
- **A hole inside `<![CDATA[…]]>` ends the component with a remedy.** The parser reads CDATA in SVG
  as text, which swallowed the hole's markers and failed with an invariant error.
- **Hashing an object no longer keeps its property names forever.** A module-level cache retained
  every distinct key ever hashed, so an object keyed by ids grew memory once per row for the life
  of the page.
- **A hole inside an event name is no longer dropped.** `on${eventName}=${handler}` and
  `on-${suffix}=${handler}` bound an attribute literally named `on` and discarded the hole. Both
  now compose the name and bind the event it spells, native and custom alike.
- **A composed event name binds a listener, not an IDL property.** `<button ${"onclick"}=${fn}>`
  assigned `element.onclick` while the literal spelling used `addEventListener`. Every attribute
  lane now resolves the name the same way.
