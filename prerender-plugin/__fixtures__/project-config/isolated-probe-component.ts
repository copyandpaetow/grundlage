//@ts-expect-error same virtual import, for the isolated loader that cannot resolve it
import { greeting } from "virtual:greeting";
import { component, html } from "../../../lib/src";

customElements.define(
	"ssr-isolated-probe",
	component(function* () {
		yield () => html`<p>${greeting}</p>`;
	}),
);
