export const FORM_EVENTS = {
	associated: "form-associated",
	disabled: "form-disabled",
	reset: "form-reset",
	restore: "form-state-restore",
} as const;

export class FormBase extends HTMLElement {
	static formAssociated = true;

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
		this.dispatchEvent(new Event(FORM_EVENTS.reset));
	}

	formStateRestoreCallback(state: unknown, mode: "restore" | "autocomplete") {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.restore, { detail: { state, mode } }),
		);
	}
}
