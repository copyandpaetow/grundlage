//on the server, before a component runs: a renderer that leaves the component for the browser
//cancels it, and the component stays unstarted
export class ComponentRenderEvent extends Event {
	static readonly eventName = "grundlage-render";

	constructor() {
		super(ComponentRenderEvent.eventName, {
			bubbles: true,
			composed: true,
			cancelable: true,
		});
	}
}
