import { expect, test, vi } from "vitest";
import { component, ComponentErrorEvent } from "../../index";

const sleep = (duration = 0) => new Promise((resolve) => setTimeout(resolve, duration));

test("an uncaught error leaves the shadow tree empty and still reports", async () => {
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	customElements.define(
		"production-thrower",
		component(function* () {
			yield function* () {
				throw new Error("token=secret");
			};
		}),
	);
	const element = document.createElement("production-thrower");
	let reportedError: unknown = null;
	element.addEventListener(ComponentErrorEvent.eventName, (event) => {
		reportedError = event.error;
	});
	document.body.appendChild(element);
	await sleep();

	expect(element.shadowRoot?.childNodes.length).toBe(0);
	expect(reportedError).toEqual(new Error("token=secret"));
	expect(consoleError).toHaveBeenCalledOnce();
	consoleError.mockRestore();
	element.remove();
});
