/*
parent class for form-associated components, selected by render() when options.formAssociated is set.

the two things here can't be delivered any later than this:
- `static formAssociated` is read by the browser at customElements.define time (inherited through the subclass render() returns, which is spec-allowed)
- attachInternals() must run once, in the constructor, before connectedCallback

the four lifecycle callbacks are re-broadcast as non-bubbling events on the host. users listen imperatively (host.addEventListener) or declaratively via the host-attribute mirror (<template on-form-reset="${fn}">). multiple listeners and listener cleanup come for free from the platform / the attribute-binding layer
*/

//dispatched event types. the declarative attribute is `on-` + type (e.g. on-form-reset): these names have no IDL property, so the `on-` form is required — applyAttributeBinding strips the prefix via slice(3) and binds the listener unconditionally
//single source of truth: the callbacks below reference these values, so renaming the public event surface is one edit here
export const FORM_EVENTS = {
	associated: "form-associated",
	disabled: "form-disabled",
	reset: "form-reset",
	restore: "form-state-restore",
} as const;

export class FormBase extends HTMLElement {
	static formAssociated = true;

	//happy-dom (and other SSR DOMs) don't implement attachInternals yet, so guard it. null on the server; live in the browser, where form code actually runs
	internals: ElementInternals | null =
		typeof this.attachInternals === "function" ? this.attachInternals() : null;

	formAssociatedCallback(form: HTMLFormElement | null) {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.associated, { detail: { form } }),
		);
	}

	formDisabledCallback(disabled: boolean) {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.disabled, { detail: { disabled } }),
		);
	}

	formResetCallback() {
		//no payload → a plain Event skips the CustomEvent.detail allocation
		this.dispatchEvent(new Event(FORM_EVENTS.reset));
	}

	formStateRestoreCallback(state: unknown, mode: "restore" | "autocomplete") {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.restore, { detail: { state, mode } }),
		);
	}
}
