//@ts-expect-error resolved by the fixture config's plugin, which only the project-config loader runs
import { greeting } from "virtual:greeting";
import { component, html } from "../../../lib/src";

customElements.define(
	"ssr-greeting",
	component(function* () {
		yield () => html`<p>${greeting}</p>`;
	}),
);
