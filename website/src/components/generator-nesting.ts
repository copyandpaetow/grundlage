import { html, component } from "../../../lib/src";

customElements.define(
	"generator-nesting",
	component(function* ({ host }) {
		let items = [1, 2, 3];

		const shuffle = () => {
			items = [...items].sort(() => Math.random() - 0.5);
			host.update();
		};

		yield async function* () {
			const controller = new AbortController();

			// Pre-yield: capture current positions (old DOM)
			const positions = new Map();
			for (const child of host.shadowRoot!.querySelectorAll("li")) {
				positions.set(child.dataset.id, child.getBoundingClientRect());
			}

			yield html`
				<button onclick=${shuffle}>shuffle</button>
				<ul>
					${items.map((id) => html`<li data-id=${id}>${id}</li>`)}
				</ul>
			`;

			// Post-yield: measure new positions, animate the delta
			for (const child of host.shadowRoot!.querySelectorAll("li")) {
				const before = positions.get(child.dataset.id);
				if (!before) continue;
				const after = child.getBoundingClientRect();
				child.animate(
					[
						{
							transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)`,
						},
						{ transform: "none" },
					],
					{ duration: 300, easing: "ease-out" },
				);
			}

			// Async work; user-owned cancellation
			try {
				await new Promise((resolve, reject) => {
					const id = setTimeout(resolve, 1000);
					controller.signal.addEventListener("abort", () => {
						clearTimeout(id);
						reject(controller.signal.reason);
					});
				});
				console.log("post-render settled for order:", items.join(","));
			} catch {
				// aborted
			}

			return () => {
				controller.abort();
				console.log("cleanup for order:", items.join(","));
			};
		};
	}),
);
