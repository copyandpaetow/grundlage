export const FORM_EVENTS = {
	ASSOCIATED: "form-associated",
	DISABLED: "form-disabled",
	RESET: "form-reset",
	RESTORE: "form-state-restore",
} as const;

export class FormBase extends HTMLElement {
	static formAssociated = true;

	formAssociatedCallback(form: HTMLFormElement | null) {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.ASSOCIATED, { detail: { form } }),
		);
	}

	formDisabledCallback(disabled: boolean) {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.DISABLED, { detail: { disabled } }),
		);
	}

	formResetCallback() {
		this.dispatchEvent(new Event(FORM_EVENTS.RESET));
	}

	formStateRestoreCallback(state: unknown, mode: "restore" | "autocomplete") {
		this.dispatchEvent(
			new CustomEvent(FORM_EVENTS.RESTORE, { detail: { state, mode } }),
		);
	}
}
