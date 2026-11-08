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
- Props are declared with the `prop` namespace: `String` → `prop.optional(prop.attribute(String))`, `[Number, 0]` → `prop.attribute(Number, 0)`, a JS-only object → `prop.property<Type>()`; the old entries throw.
- A prop without a fallback or `prop.optional` is required: the body waits until it is set, and the server throws when nothing sets it.
- `props(element, schema)` → `prop.read(element, schema)`.
- A binding a later paint drops passes `undefined`, not `null`, so a `prop.property` can hold `null`.
- A template nested inside an object fallback is copied per element and no longer paints: make the template the whole fallback.

### Types

- `YieldableValue` is `Template | Promise<unknown> | UpdateGenerator` or a `load()` request; `UpdateGenerator` is exported.
- `yield* load(…)` evaluates to the fetcher's awaited type.
- A bare `yield promise` evaluates to `unknown`: `const user: User = yield …` → `const user = yield* awaited(…)`.
- A hoisted schema needs no `satisfies Schema`, and a fallback is type-checked against its parser.
- `PropsOf<typeof props>` and `PassedPropsOf<typeof props>` replace `DeclaredProps`.

### Added

- `awaited(promise)`: `yield*` it to wait with the promise's type.
- `prop.property(standardSchema, fallback?)` validates every write with a Standard Schema (Zod, Valibot, ArkType).
- Pages that enforce Trusted Types paint: the library writes its template markup through a policy named `grundlage`.
- `prop.unreflected(prop.attribute(…))` keeps the attribute as the markup default, like a native input's `value`.
- `prop.oneOf("a", "b")` parses a union of strings.
- On the server, a binding to a `prop.property` marks the child `defer-hydration`.
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
- A template with an unclosed comment, tag, attribute value or `<style>`/`<script>`/`<textarea>` throws and names what to close, instead of dropping the rest.
- U+E000 in a template throws and asks for `&#xE000;`.
- A dynamic `<style>` whose nested selectors contain `:` (`&:hover`, `a:hover`) updates through CSSOM instead of rewriting the sheet text.
- Holes inside a nested `<template>` bind like any other hole, and a changed value rebuilds its content.
- A listener, a property or a prop inside a nested `<template>` throws, since copies of the content keep none of them.
- `shadowrootmode` on a nested `<template>` throws: let the element attach its own shadow root.

### Fixed

- On the server, a body that catches an update generator's error runs its `finally`, also when that generator called `update()`.
- An `update()` queued for an update generator the body drops settles with the drop instead of re-running the next one.
- A child moved straight after its parent's paint runs its update generator once.
- A component whose own prop write throws in the prop's parser ends once that step or paint is over, instead of painting over the error.
- A component whose host binding ended it during an update or a hydration paints again once it is re-inserted.
- A generator whose own prop write ends its component still runs its cleanup and its `finally` block, an update generator's before the body's.
- An error thrown after a component's own prop write has ended it is reported, instead of ending the component twice or going missing.
- A component body's `this` is `undefined`, as an update generator's is, instead of an internal object.
- A component body whose parameter default throws ends the component through the error event instead of escaping the library.
- An object or array bound to another library's custom element, such as a Lit element, no longer calls its `update()`.
- A `<![CDATA[…]]>` section keeps the markup after it instead of dropping the rest of the template.
- In Safari, a `:host` value hole in a dynamic `<style>` updates the host after the first change, instead of keeping the old value.
- A hole in an `!important` declaration inside `@keyframes`, which the browser drops, no longer gets a CSSOM update.
- `<br />` paints one line break instead of two.
- A void element written without a slash inside `<${tag}>` no longer throws "asymmetric tag".
- A `<` that opens no tag (`${a} < ${b}`) is text instead of an internal error.
- A `<!` that opens no comment throws and names the fix.
- A bound element the HTML parser moves (a `<div>` in a `<p>`, a `<p>` or `<textarea>` in a `<table>`) throws "Fix the nesting" instead of breaking the component.
- A bound bare `<tr>` no longer binds the `<tbody>` the HTML parser adds around it.
- A bound formatting element the HTML parser copies (`<p><b class=${x}><div>`) throws "Fix the nesting" instead of leaving the copies without the value.
- A tag or attribute name composed from a value the browser refuses (`<${"my box"}>`) throws a library error naming the binding instead of a bare `DOMException`.
- A dynamic `<style>` with a `{` or `[` inside parentheses, an escaped property name or a trailing `\` falls back to a full text rewrite instead of updating the wrong declaration or hanging.
- Change detection no longer reads a changed value as unchanged because two hashes collided.
- Data with a reference back to an enclosing object (a `parent` link) no longer freezes a paint.
- A value too large to walk on every paint, or one shared the way a graph is, throws and names the fix.
- A symbol inside a bound object or array no longer ends the component with a `TypeError`.
- A value that would end its `<style>`, `<script>` or comment early in server markup (`</style`, `</script`, `-->`) throws instead of injecting markup.
- A hole inside `<noscript>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>` or after `<plaintext>` throws when the template is parsed, instead of letting a value inject markup.
- A hole inside `<title>` paints as text, like one in `<textarea>`, instead of throwing in the browser and writing markers into server markup.
- An object shaped like a template, from JSON or `structuredClone`, no longer paints as markup.
- A value inside a nested `<template>` no longer becomes markup.

## 0.8.0

### Breaking

- The component body takes one props object: `function* (host)` → `function* ({ host, …props })`; render functions and inner generators get the same object.
- The schema is declared in the options, `component(gen, { props })`, and a generator passed to `component` no longer brings its own.
- `load()`'s option `skipSsr` → `skipSSR`.

### Types

- A yielded render function types its parameter: `yield ({ label }) => …` is no longer an implicit `any`.
- A `yield*` helper that annotates its return type spells it `Generator<YieldableValue>`, not bare `Generator`.
- `YieldableValue` is exported.
- The component body's return position is `Cleanup | void`, and `Cleanup` is exported.

### Added

- A fatal error dispatches a cancelable `grundlage-error` event; `preventDefault()` skips the console line and the error text.
- Warnings ship only in the development build, picked by the `development` export condition.
- A dynamic tag or a nested template that puts a block element inside a `<p>` warns in the development build.

### Changed

- `value`, `checked`, `indeterminate` and `selected` are written as the attribute on a binding's first commit and as the property after it, so a state change shows after the user interacted.
- `<select value=${…}>` warns and selects nothing: bind `selected` on each `<option>`.
- A fatal error logs with `console.error` and names the tag, instead of `console.warn`.
- A throwing cleanup or a rejected async `return()` goes to `reportError`.
- A host binding that writes the component's own declared prop updates the component, on the server too.
- A host binding derived from the prop it writes (`count=${count + 1}`) ends in the update-loop error.
- A component body's return that is neither a function nor `undefined` warns.
- `/>` after an unquoted attribute value ends the tag: `<rect width=${w}/>` no longer sets `width="2/"`.

### Fixed

- A custom property updated to a CSS-wide keyword (`--x: ${"initial"}`) takes its effect.
- A dynamic tag inside `<p>` no longer breaks the component.
- A dynamic tag the HTML parser relocates (`<${"tr"}>` in a `<tbody>`) ends the component and names the fix.
- Templates inside `<svg>` and `<math>` mount in their namespace, and `<foreignObject>` or `<mi>` switch back to HTML.
- A dynamic tag inside `<svg>` or `<math>` keeps its namespace and case.
- A dynamic tag that would become `<svg>` or `<math>` inside HTML throws: write that tag statically.
- A hole inside `<![CDATA[…]]>` ends the component and names the fix.
- Hashing an object no longer keeps its property names in memory for the life of the page.
- A hole inside an event name (`on${eventName}=${handler}`) binds the event it spells instead of an attribute named `on`.
- A composed event name (`<button ${"onclick"}=${fn}>`) binds a listener, not a property.
