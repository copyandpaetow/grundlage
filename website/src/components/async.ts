import { render, html } from "../../../lib/src";

const mockFetch = () =>
	new Promise<{ name: string; lastName: string; age: string }>(
		(resolve, reject) => {
			setTimeout(
				() =>
					Math.random() > 0.5
						? resolve({ name: "tim", lastName: "timson", age: "999" })
						: reject("faulty"),
				2000 * Math.random(),
			);
		},
	);

export const Component = render("async-component", async function* () {
	yield html`<p>loading</p>`;

	try {
		const data = await mockFetch();
		yield html`<p>name:${data.name} ${data.name}, age: ${data.age}</p>`;
	} catch (error) {
		yield html`<p>error: ${error}</p>`;
	}

	return () => {
		console.log("cleanup");
	};
});
