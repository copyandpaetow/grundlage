export const FORM_EVENTS = {
	ASSOCIATED: "form-associated",
	DISABLED: "form-disabled",
	RESET: "form-reset",
	RESTORE: "form-state-restore",
} as const;

const createFormAssociatedBaseClass = () =>
	class FormAssociatedBase extends HTMLElement {
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
	};

export type FormAssociatedBase = InstanceType<
	ReturnType<typeof createFormAssociatedBaseClass>
>;

// built on first use so importing the library never touches `HTMLElement`, and shared from
// then on so every form-associated component stays a single `instanceof` lineage
let sharedFormAssociatedBaseClass: ReturnType<
	typeof createFormAssociatedBaseClass
> | null = null;

export const getFormAssociatedBaseClass = () =>
	(sharedFormAssociatedBaseClass ??= createFormAssociatedBaseClass());
