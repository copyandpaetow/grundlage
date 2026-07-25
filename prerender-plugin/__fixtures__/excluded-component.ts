//lives in its own file so a test can drop it with `exclude` — nothing else ever includes it
import { component, html } from "../../lib/src";
import { TAGS } from "./tags";

customElements.define(
	TAGS.excluded,
	component(function* () {
		yield () => html`<p>excluded-rendered</p>`;
	}),
);
