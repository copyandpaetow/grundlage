export class ComponentErrorEvent extends Event {
	static readonly eventName = "grundlage-error";

	constructor(
		readonly error: unknown,
		//event.target is retargeted to the outermost host at every shadow boundary
		readonly tagName: string,
	) {
		super(ComponentErrorEvent.eventName, {
			bubbles: true,
			composed: true,
			cancelable: true,
		});
	}
}

declare global {
	interface HTMLElementEventMap {
		[ComponentErrorEvent.eventName]: ComponentErrorEvent;
	}
	interface DocumentEventMap {
		[ComponentErrorEvent.eventName]: ComponentErrorEvent;
	}
}
