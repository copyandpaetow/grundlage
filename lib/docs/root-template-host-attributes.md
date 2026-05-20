# Root template host attributes

A component can yield an `html` template whose single root element is a
`<template>`. The wrapper is stripped from the output, and any attributes
declared on it — static, dynamic, or expandable — are mirrored to the
component's host element on every render.

```javascript
import { render, html } from "grundlage";

customElements.define(
	"my-card",
	render(function* (host) {
		let busy = false;
		host.addEventListener("click", () => {
			busy = !busy;
			host.update();
		});

		yield () => html`
			<template class="card" role="region" aria-busy="${busy}">
				<p>contents</p>
			</template>
		`;
	}),
);
```

After mount, the host carries `class="card" role="region" aria-busy="false"`;
the shadow root contains only the `<p>contents</p>`.

## Why

The host element has always been opaque to the template: its children were
rendered into the shadow root, but its own attributes had to be set
imperatively from the generator. That made it awkward to express things like
ARIA roles, layout classes, or boolean state on the component itself
declaratively. The root-template form treats the host as just another element
in the tree — its attributes participate in the same binding pipeline as the
rest of the template, with no extra API surface.

## What is supported

Every binding shape that works on a regular element works on the root template:

- **Static attributes** — `<template class="card">`
- **Boolean static attributes** — `<template hidden>`
- **Dynamic values** — `<template id="${id}">`
- **Multi-part values** — `<template class="${a} ${b}">`, `<template class="prefix ${dyn} suffix">`
- **Dynamic attribute names** — `<template data-${suffix}="value">`, `<template ${name}>`
- **Expandable bindings** — `<template ${{ id, role }}>`, `<template ${["hidden", "inert"]}>`, `<template ${"hidden"}>`

Mixed static + dynamic attributes coexist and preserve source order.

Nested templates inside the root template are treated as raw content (the same
as elsewhere in the parser); they do not become host bindings.

## Top-level only

Root templates are a top-level feature of a component's render output. A
`<template ...>` with attributes that ends up inside another template's
`${...}` content — or as a list item — throws at setup. Without that gate,
nested root templates would silently target the outer component's host
element, with no cleanup when the parent content binding swapped them out.

## What is not a root template

Detection is deliberately narrow. The parser only treats a `<template>` as the
root when:

- It is the literal tag name `<template>` (a dynamic `<${tag}>` whose runtime
  value is `"template"` does **not** qualify).
- It is the first element in the literal.
- All siblings are whitespace or static comments.

Any of the following force the template to render as a normal `<template>`
element with no host bindings:

- Text or element siblings before or after the template.
- A `<template>` nested inside another element.
- A dynamic outer tag, even when the runtime tag name is `"template"`.

When the parser can only discover a disqualifying sibling at the end of the
literal (it can't look ahead), it re-runs `parse` with a `forceNoRootTemplate`
flag so the second pass treats the `<template>` as a regular special element.
`forceNoRootTemplate` is reset on every `setup()` so the reparse path cannot
leak into the next parse.

## How it works

### Parser (`lib/src/parser/html.ts`)

- `isRootTemplate` flips on in `completeTag` when the first open tag is the
  literal `template` and `forceNoRootTemplate` is false. A dynamic open uses
  `PLACEHOLDER_TAG` (`"div"`), so dynamic tags are excluded for free.
- `completeAttribute` routes host attributes into bindings instead of
  serializing them onto the element:
  - Dynamic host attributes become regular `AttributeBinding`s but skip the
    comment marker (the host element is the target — no marker needed) and
    increment `hostBindingOffset` instead.
  - Static host attributes get lowered into `AttributeBinding`s with empty
    `values` slots so they ride the same target/dirty machinery as dynamic
    bindings. They consume no expression slot, so `update()` never marks them
    dirty — zero per-update cost.
- After the walk, if the first element is `<template>` and every sibling is
  whitespace or a comment, the template wrapper is replaced with its
  `content` (`firstChild.replaceWith(firstChild.content)`), removing the
  `<template>` element from the fragment entirely.
- The post-parse check otherwise calls `parse(strings, true)` to reparse with
  the root-template path disabled.

`ParsedHTML` exposes `hostBindingOffset: number` — the count of leading
bindings that target the host.

### Renderer (`lib/src/rendering/template-html.ts`)

- `#findTargets` pre-fills the first `hostBindingOffset` entries of `targets`
  with the host element, then walks the fragment for child markers as usual.
  Host bindings share the binding/target/dirty arrays with everything else —
  no parallel storage.
- A template with `hostBindingOffset > 0` but no host throws at setup. The
  component's `#renderToDom` passes itself as the host, but every other call
  site — list items, `${...}` content, anything routed through
  `content.ts` — calls `setup(null)`. A nested `<template ...>` with
  attributes therefore fails fast with a message naming the misuse.
- `clearHostAttributes(host)` walks the leading host bindings and calls
  `removeAttributeBinding` for each, so when the renderer swaps to a
  structurally different template (different `templateHash`), it can wipe the
  previous template's host attributes before the new template runs `setup`.
- `hydrate()` re-applies every `ATTR` binding so host bindings — which SSR
  never serialized onto the host — land correctly on hydration.

### Component (`lib/src/index.ts`)

- `#renderToDom` brackets the `MutationObserver` around any render that could
  touch the host (`touchesHost = current.hostBindingOffset > 0 ||
previous.hostBindingOffset > 0`). Disconnecting empties the observer's
  record queue per spec, so framework-driven host writes inside this
  synchronous block never queue a redundant `update()`. The bracket is
  synchronous, so no user code runs in the gap and no legitimate user
  mutation is lost.
- Components that never use root templates pay nothing — `touchesHost` stays
  false and the observer is never disconnected.
- On structural swaps, `previousTemplate.clearHostAttributes(this)` runs
  before the new template's `setup` writes its host attrs.

## Behavioral guarantees (pinned by tests)

- **Static + dynamic order** — bindings preserve source order; host bindings
  always precede inner bindings (`bindings[0..hostBindingOffset]` are host).
- **Dynamic updates** — re-rendering with new expression values updates host
  attributes in place; static attributes never re-write.
- **Cross-template cleanup** — when a render returns a template whose host
  attributes differ from the previous one, leftover host attributes from the
  previous template are removed. This holds across:
  - root → root with different attrs
  - root → non-root template
  - non-root → root template
  - A → B → A swaps (re-applying the original)
  - Nested-generator swaps (driven by `#restartGenerator`)
- **Same-template name changes** — dropping a key from an expandable
  object/array, or changing a dynamic attribute name, removes the previous
  name from the host.
- **No feedback loop** — framework-driven host writes during render are not
  observed by the host `MutationObserver`, so they never queue a re-render.
  User-driven `setAttribute` calls outside the render block still trigger
  `update()` normally.
- **No shadow leakage** — host attributes never appear on any child element
  inside the shadow root.
- **Reparse isolation** — a misdetected template setting
  `forceNoRootTemplate` mid-parse does not affect the next parse call.

## Tests

- Parser detection, ordering, reparse, and nesting:
  `lib/src/parser/html-root-template.dom.test.ts`
- Rendering, updates, swap cleanup, and observer suppression:
  `lib/src/rendering/host-attributes.browser.test.ts`
