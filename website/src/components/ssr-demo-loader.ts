import { html, render } from "../../../lib/src";

//deterministic so server and client compute the same payload — hydration matches and nothing has to be re-fetched at runtime
//(in a real app the server-rendered HTML would carry whatever the server fetch returned; the client gets to skip the loading state because the data is already painted)
const fetchUser = (delayMilliseconds: number) =>
	new Promise<{ name: string; team: string }>((resolve) => {
		setTimeout(
			() => resolve({ name: "Lucas P.", team: "Library team" }),
			delayMilliseconds,
		);
	});

customElements.define(
	"demo-loader",
	render(async function* (host) {
		const label = host.getAttribute("data-label") ?? "?";
		const delayMilliseconds = parseInt(
			host.getAttribute("data-delay-ms") ?? "0",
			10,
		);
		const startedAt = performance.now();
		const user = await fetchUser(delayMilliseconds);
		const elapsedMilliseconds = Math.round(performance.now() - startedAt);

		//single renderable yield: the SSR pass stops here with the data already resolved, so the prerendered HTML carries the populated card
		//on the client this same yield runs again; if the SSR shadow root is present, the hydrate path leaves CONTENT bindings alone and the server-fetched text stays put
		yield () => html`
			<article class="card">
				<header><strong>${label}</strong></header>
				<dl>
					<dt>name</dt>
					<dd>${user.name}</dd>
					<dt>team</dt>
					<dd>${user.team}</dd>
				</dl>
				<small>fetched in ${elapsedMilliseconds} ms</small>
			</article>
		`;
	}),
);
