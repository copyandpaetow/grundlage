# Form-associated components

Pass `formAssociated: true` to `render()` and the component joins a `<form>` like
a native control: it participates in submission, reset, disabling, and state
restore. The flag sits alongside the shadow-root options, so pass the rest of the
`ShadowRootInit` you want with it — the option object replaces the defaults
wholesale, it is not merged.

```javascript
import { render, html } from "grundlage";

customElements.define(
	"form-field",
	render(
		function* (host) {
			let value = "";
			const onInput = (event) => {
				value = event.target.value;
				host.internals?.setFormValue(value); // what the form submits
				host.update();
			};
			const onReset = () => {
				value = "";
				host.internals?.setFormValue("");
				host.update();
			};

			yield () => html`
				<template on-form-reset="${onReset}">
					<input oninput="${onInput}" />
				</template>
			`;
		},
		{ mode: "open", formAssociated: true },
	),
);
```

`<form-field name="nickname">` now appears in the form's `FormData` under
`nickname`, and clears when the form resets.

## Two halves

### `static formAssociated` + `internals` (`lib/src/form-base.ts`)

When `formAssociated` is set, `render()` swaps the component's parent class from
`HTMLElement` to `FormBase`. `FormBase` carries the two things the platform must
see early — neither can be delivered any later:

- `static formAssociated = true` — the browser reads this off the constructor at
  `customElements.define` time. Static fields inherit, so the subclass `render()`
  returns exposes it.
- `attachInternals()` — called once in the field initializer, before
  `connectedCallback`. The result is exposed as `host.internals`
  (`ElementInternals`): the handle for `setFormValue`, `setValidity`, form
  lookup, and the rest. It is `null` on SSR DOMs that don't implement
  `attachInternals`, so server renders don't crash — form code only runs in the
  browser anyway.

### Lifecycle as events

The four form lifecycle callbacks are re-broadcast as non-bubbling events on the
host, so reacting to them never requires subclassing:

| callback                                | event                | detail                           |
| --------------------------------------- | -------------------- | -------------------------------- |
| `formAssociatedCallback(form)`          | `form-associated`    | `{ form }`                       |
| `formDisabledCallback(disabled)`        | `form-disabled`      | `{ disabled }`                   |
| `formResetCallback()`                   | `form-reset`         | — (plain `Event`, no allocation) |
| `formStateRestoreCallback(state, mode)` | `form-state-restore` | `{ state, mode }`                |

Listen imperatively (`host.addEventListener("form-reset", …)`) or declaratively
through the root-template host mirror with the `on-` prefix:
`<template on-form-reset="${fn}">`. Multiple listeners and listener cleanup come
for free from the platform and the attribute-binding layer.

## Why `on-` and not `on`

These event names (`form-reset`, …) have no matching IDL property, so the normal
`onclick`-style binding — which gates on `name in element` — would skip them. The
`on-` prefix is the explicit-listener form: `applyAttributeBinding` strips `on-`
and calls `addEventListener` unconditionally, no property gate. It shares the
swap/removal path with `onclick`, so it costs nothing extra. The host mirror that
puts these listeners on the component element is documented in
`root-template-host-attributes.md`.

## Tests

- `FormBase` static surface, event broadcasting, parent-class selection, and the
  end-to-end `on-form-reset` wiring: `lib/src/form-base.dom.test.ts`
- The `on-` explicit-listener binding in isolation:
  `lib/src/rendering/attribute.dom.test.ts`
