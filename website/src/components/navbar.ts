import { render, html } from "../../../lib/src";

render("nav-bar", function* () {
	yield html`
		<nav>
			<a href="/grundlage">home</a>
			<a href="/grundlage/pages/async/">async</a>
			<a href="/grundlage/pages/animation/">animation</a>
			<a href="/grundlage/pages/list/">list</a>
		</nav>
	`;
});
