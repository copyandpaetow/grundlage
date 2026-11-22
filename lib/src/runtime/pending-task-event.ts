//the webcomponents-cg pending-task protocol: an ancestor that waits for what it holds, such as a
//server render, hears from every component inside it, through shadow roots too
export class PendingTaskEvent extends Event {
	static readonly eventName = "pending-task";

	constructor(readonly complete: Promise<unknown>) {
		super(PendingTaskEvent.eventName, { bubbles: true, composed: true });
	}
}
