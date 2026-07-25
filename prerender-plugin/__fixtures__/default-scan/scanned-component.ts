//its own directory: a test points the plugin's root here and passes no `include`, so the
//default "everything under root" glob is what finds this file
import { component, html } from "../../../lib/src";

customElements.define(
	"ssr-default-scan",
	component(function* () {
		yield () => html`<p>default-scan-rendered</p>`;
	}),
);
