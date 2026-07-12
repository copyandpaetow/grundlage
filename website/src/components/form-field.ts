import { html, component } from "../../../lib/src";
import { type ComponentConstructor } from "../../../lib/src/types";

// form-associated custom element. it submits through ElementInternals.setFormValue
// and reacts to the form's lifecycle declaratively: FormBase re-broadcasts the
// browser's formResetCallback / formDisabledCallback as on-form-reset /
// on-form-disabled listeners on this host.
const FormField = component(
	function* (host) {
		let value = "";
		let disabled = false;
		const internals = host.internals;

		const onInput = (event: Event) => {
			value = (event.target as HTMLInputElement).value;
			internals?.setFormValue(value);
			host.update();
		};

		const onReset = () => {
			// the input is uncontrolled, so clear its dirty value directly; setting
			// the value attribute wouldn't move an already-edited input
			const input = host.shadowRoot?.querySelector("input");
			if (input) input.value = "";
			value = "";
			internals?.setFormValue("");
			host.update();
		};

		const onDisabled = (event: Event) => {
			disabled = (event as CustomEvent<{ disabled: boolean }>).detail.disabled;
			host.update();
		};

		yield () => html`
			<template on-form-reset="${onReset}" on-form-disabled="${onDisabled}">
				<label>
					nickname
					<input
						type="text"
						oninput="${onInput}"
						${disabled ? "disabled" : ""}
					/>
				</label>
				<p>value seen by the form: <strong>${value || "(empty)"}</strong></p>
			</template>
		`;
	},
	{ mode: "open", formAssociated: true },
) as ComponentConstructor;

customElements.define("form-field", FormField);

declare global {
	interface HTMLElementTagNameMap {
		"form-field": InstanceType<typeof FormField>;
	}
}
