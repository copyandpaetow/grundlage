import { html, load, component } from "../../../lib/src";

const fetchUser = (delayMilliseconds: number) =>
	new Promise<{ name: string; team: string }>((resolve) => {
		setTimeout(
			() => resolve({ name: "Lucas P.", team: "Library team" }),
			delayMilliseconds,
		);
	});

customElements.define(
	"demo-loader",
	component(function* ({ host }) {
		const label = host.getAttribute("data-label") ?? "?";
		const delayMilliseconds = parseInt(
			host.getAttribute("data-delay-ms") ?? "0",
			10,
		);
		const startedAt = performance.now();
		//the server writes the result into this host's shadow root as a <script data-ssr>, and the hydrating browser reuses it instead of fetching
		const user = yield* load(() => fetchUser(delayMilliseconds));
		const elapsedMilliseconds = Math.round(performance.now() - startedAt);

		//closure state — click runs through update(), which re-runs the view; smallest possible "hydration wired things up" signal
		let clickCount = 0;

		//single renderable yield: the SSR pass stops here with data resolved; on the client the view's first run leaves the server text in place
		yield function* view() {
			yield html`
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
		};
	}),
);
