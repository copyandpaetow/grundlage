import { html, loadData, render } from "../../../lib/src";

//deterministic so server and client compute the same payload; in a real app the server fetch would land in the SSR HTML and the client would skip the loading state
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
		//per-host scope — the server writes a <script data-ssr> into this host's shadow root and the client replays it from there
		const user = await loadData(host, () => fetchUser(delayMilliseconds));
		const elapsedMilliseconds = Math.round(performance.now() - startedAt);

		//closure state — click runs through update(), which re-invokes the render fn; smallest possible "hydration wired things up" signal
		let clickCount = 0;

		//single renderable yield: the SSR pass stops here with data resolved; on the client the same yield re-runs and hydrate leaves the server text in place
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
				<button
					type="button"
					class="reactivity-probe"
					onclick="${() => {
						clickCount++;
						host.update();
					}}"
				>
					clicked ${clickCount} ${clickCount === 1 ? "time" : "times"}
				</button>
			</article>
		`;
	}),
);
