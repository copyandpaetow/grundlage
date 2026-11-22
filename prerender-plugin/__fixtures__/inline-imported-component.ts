//only an inline module script imports this file, so its tag is defined exactly when the plugin
//reads what inline scripts import
import { component, html } from "../../lib/src";
import { TAGS } from "./tags";

customElements.define(
	TAGS.inlineImported,
	component(function* () {
		yield function* view() {
			yield html`<p>inline-imported-rendered</p>`;
		};
	}),
);
