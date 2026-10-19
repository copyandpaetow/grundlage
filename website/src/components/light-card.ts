import { component, html } from "../../../lib/src";
import * as grundlage from "../../../lib/src";
import type { ComponentOptions, Schema } from "../../../lib/src/types";

//RULES.md's example component, defined in both modes so the page can compare them. Neither slots
//nor light mode ship yet: the namespace read and the options cast are what let this file load
//against today's library and start working on its own when they do

const { Slot, DefaultSlot } = grundlage as typeof grundlage & {
	Slot?: unknown;
	DefaultSlot?: unknown;
};

export const slotsShip = Slot !== undefined && DefaultSlot !== undefined;

export const lightModeShips =
	Object.getOwnPropertyDescriptor(
		component(function* () {}).prototype,
		"renderRoot",
	) !== undefined;

const userCard = function* (props: Record<string, unknown>) {
	yield function* view() {
		yield html` <style>
				:host,
				:scope {
					display: block;
				}
				article {
					border: 1px solid currentColor;
					padding: 0.75rem;
				}
				header {
					font-weight: 700;
				}
			</style>
			<article>
				<header>${props.heading}</header>
				<nav>${props.heading}</nav>
				${props.body}
				<p>
					<input id="reached-by-a-label" />
					<span id="reached-by-a-fragment">a :target</span>
				</p>
				${props.footer}
			</article>`;
	};
};

//the slot half of the schema is a both-modes rule, so the shadow control declares it too
const cardOptions = (mode: string): ComponentOptions =>
	({
		mode,
		props: slotsShip
			? {
					heading: Slot,
					body: DefaultSlot,
					footer: [Slot, html`<footer>—</footer>`],
				}
			: {},
	}) as unknown as ComponentOptions<Schema>;

customElements.define(
	"shadow-card",
	component(userCard as never, cardOptions("open")),
);

if (lightModeShips)
	customElements.define(
		"light-card",
		component(userCard as never, cardOptions("light")),
	);
