# Idea

## parsing html

We have a html tagged template literal helper function that takes the static templateStringArray and turns it into
documentFragment and bindings for each slot.
Since the templateStringArray is unique, we can cache the result and avoid the parsing cost from string to
documentFragment, which is usually one of the bottlenecks.

### fragment

The fragment marks the dynamic parts with comment nodes. Most binding types only need one comment node, the content
binding needs 2 (to replace everything between on value change).
Having a comment for every binding "slot" makes it possible to hook up a server rendered version again, without having
to re-render the component.

The one exception is root-template host bindings (see below): they target the component element itself, which lives
outside the fragment, so they don't get a comment marker at all.

### bindings

Bindings describe the gaps/holes/slots of the tagged template literal input. There are currently 4 types: tag,
attribute, rawContent (style, textArea), and content.
These bindings have somewhat different shapes what mainly involve arrays with either string content or numbers (numbers
are indices into the expressions array, strings are literal text).

```ts
html`<div class="${dynamicClass1} static ${dynamicClass2}"></div>`[
	//becomes
	fragment: <!--marker--><div></div>
	bindings: [{
		keys: ["class"],
		values: [0, "static ", 1],
	}],
	expressionToBinding: [0, 0]
];
```

They than can be combined with the expression array to the final html part (an attribute in this case). Like in the
example above, a binding can be made out of more than one dynamic part.

### root templates

A top-level `<template>` element is treated as a declarative wrapper for the component host. Its children become the
shadow DOM, and any attributes on the wrapper — static or dynamic — are applied to the host element itself.

```ts
html`<template class="card" id="${dynamicId}">
	<p>${content}</p>
</template>`;
```

Both `class` and `id` lower into the bindings array as attribute bindings — static attrs get literal string keys/values,
dynamic ones get expression indices. They live in the first `hostBindingOffset` slots of `bindings` (host bindings come
before child bindings in source order). The `<template>` wrapper itself is unwrapped during parsing and never appears in
the fragment.

If a literal looks like a root template at first but turns out to have sibling elements or text content (
`html\`<template>...</template><div>...</div>\``), the parser detects this post-parse and reparses with `
forceNoRootTemplate` to treat the template as a regular inner element.

## Runtime

### setup

When a template instance is rendered, we clone the cached fragment and walk it once to build a `targets` array — one
entry per binding, lined up with `bindings` and `dirtyBindings` by index.

- For all bindings except the content bindings, we resolve `marker.nextElementSibling` at setup and store the Element.
  The hot path then reads the element directly, skipping a DOM property read per update.
- For content bindings we store the leading Comment marker — the binding still needs it as a range anchor to find its
  matching close marker.
- For host bindings (the first `hostBindingOffset` entries) we pre-fill the slot with the host element itself. No marker
  is involved.

This means every binding handler reads its target the same way (`context.targets[bindingIndex]`) regardless of whether
it's a child element, a host element, or a content range — host attrs aren't a special case at update time.

Hydration is the same shape, just over the existing shadow root instead of a fresh fragment clone, and only re-applies
attribute bindings (child text/tags are already correct from SSR; host attrs were never serialized because they live in
bindings, so they need a fresh write).

### updating

A `dirtyBindings: Uint8Array` parallel to `bindings` tracks which bindings need re-running. On every
`update(expressions)`:

1. We walk the new expressions and compare each against the previous render's value. Primitives compare by identity;
   objects/functions fall back to a hash compare.
2. Any expression that changed sets `dirtyBindings[expressionToBinding[expressionIndex]] = 1`.
3. A flush pass iterates the dirty array and calls the matching update function for each set bit.

Static bindings (including lowered host attrs like `<template class="card">`) have no entry in `expressionToBinding`, so
step 2 never touches them — zero per-update cost. They get applied once at setup, then sit idle.

When a tag binding swaps its element, it writes the new element into `targets[bindingIndex]` for its own slot and for
every related attribute binding (which it knows about via `relatedAttributes` on the tag binding), then marks those
attrs dirty so the next flush re-applies them against the new element.

## usage

`render(generator, options?)` returns a custom element constructor; register it with `customElements.define`.
The generator receives the host element as its first argument. Each `yield` evaluates to the host element,
so inner generator/render functions can also rely on receiving the host as their first argument instead of
closing over the outer scope.

```ts
customElements.define(
    "component-name",
    render(async function* (host) {
        yield html`<p>...loading</p>`;

        const data = await fetch(...).then(response => response.json());

        yield () => html`
			<ul>
				${data.map(entry => html`<li>${entry}</li>`)}
			</ul>
		`;

        return () => console.log("cleanup");
    }),
);
```

A render function that wants to declaratively control host attributes can wrap its output in a `<template>`:

```ts
yield () => html`<template class="card" role="region" aria-busy="${isLoading}">
	<p>${content}</p>
</template>`;
```

`class` and `role` are applied once; `aria-busy` updates with `isLoading`. The template wrapper itself doesn't render —
only its children land in the shadow DOM.
