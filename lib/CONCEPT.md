# Idea

## parsing html

We have a html tagged template literal helper function that takes the static templateStringArray and turns it into
a documentFragment and bindings for each slot.
Since the templateStringArray is unique, we cache the result and avoid the parsing cost from string to
documentFragment, which is usually one of the bottlenecks.

### fragment

The fragment marks the dynamic parts with comment nodes. Most binding types only need one comment node, the content
binding needs 2 (to replace everything between on value change).
Having a comment for every binding "slot" makes it possible to hook up a server rendered version again, without
having to re-render the component.

### bindings

Bindings describe the gaps/holes/slots of the tagged template literal input. There are currently 4 types: tag,
attribute, rawContent (`style`, `script`, `textarea`, `template`), and content.
These bindings have somewhat different shapes, mainly involving arrays of either string content or expression-index
numbers.

```ts
html`<div class="${dynamicClass1} static ${dynamicClass2}"></div>`;

// becomes
fragment: <!--marker--><div></div>
bindings: [{
    keys: ["class"],
    values: [0, " static ", 1],
}],
expressionToBinding: [0, 0]
```

They can then be combined with the expression array to produce the final html part (an attribute in this case). As
in the example above, a binding can be made out of more than one dynamic part.

#### dynamic tags

A dynamic open tag (`<${tag}>`) and its close (`</${tag}>`) share a single TagBinding so they always update in
lockstep. The parser tracks every open tag — dynamic or static — on a stack, and asymmetric pairs like
`<${tag}>...</div>` or `<div>...</${tag}>` throw at parse time rather than silently picking the wrong opener.

## Runtime

### setup

In the beginning we walk the fragment to find all relevant comment nodes and read out the encoded data: binding
index and relevant expression indices.
We then take the binding at the encoded index and store the same instance at the relevant expression index
positions in a parallel array, so that the expression-to-binding lookup is a direct index access.

```ts
bindings: [attributeBinding1, attributeBinding1],
expressions: [dynamicClass1, dynamicClass2]
```

The actual update logic for each binding type lives in the `updateByType` lookup table — bindings themselves are
plain typed objects, dispatched via their `type` field.

### updating

We compare the last array of expressions with the current one. If one expression changes, we look up the binding
at the same index and run its update function. Primitives short-circuit on `===`; objects, functions, and nested
templates fall back to a content hash so structurally equal values skip DOM work. Arrays always re-run their
binding and rely on per-item hash identity inside the list reconciler to keep unchanged nodes.

## usage

`render` takes a generator function and optional shadow root options, and returns a custom element constructor.
Registration with `customElements.define` is left to the caller so the component name lives next to the
registration site rather than inside the library.

```ts
const MyComponent = render(async function* (element) {
	yield html`<p>...loading</p>`;

	const data = await fetch(...);

	yield () => html`
		<ul>${data.map((entry) => html`
			<li>${entry}</li>`,
		)}
		</ul>`;

	return () => console.log("cleanup");
});

customElements.define("component-name", MyComponent);
```
