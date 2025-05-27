import { render } from "../../../lib/src";

const promiseFactory = () =>
	new Promise((resolve) =>
		setTimeout(() => resolve("save results are safe"), 1000)
	);

const riskyPromiseFactory = () =>
	new Promise((resolve, reject) =>
		setTimeout(
			() => (Math.random() > 0.5 ? resolve("success") : reject("error")),
			5000
		)
	);

const superRiskyPromiseFactory = () =>
	new Promise((resolve, reject) =>
		setTimeout(
			() =>
				Math.random() > 0.75 ? resolve("1 in a Million") : reject("expected"),
			20000
		)
	);

export const asyncComponent = render("async-component", (_, { signal }) => {
	const [startPromiseChain, setStartPromiseChain] = signal.create(false);
	const [savePromise] = signal.createAsync(promiseFactory, startPromiseChain);
	const [riskyPromise, updateRiskyPromise] = signal.createAsync(
		riskyPromiseFactory,
		savePromise
	);

	const refetchOuterPromise = () => {
		savePromise.refetch();
	};
	const refetchInnerPromise = () => {
		riskyPromise.refetch();
	};

	const updatePromise = () => {
		updateRiskyPromise(superRiskyPromiseFactory);
	};

	return render.html`
  <button onclick="${() => setStartPromiseChain(true)}">start chain</button>
  <button onclick="${refetchOuterPromise}">refetch outer promise</button>
  <button onclick="${refetchInnerPromise}">refetch inner promise</button>
  <button onclick="${updatePromise}">update promise</button>
  <br />
  
                  <template suspense=${savePromise} id=1>
  <div>safe result: ${(value: string) => value}</div>



     <template suspense=${riskyPromise} id=2>
         <div>risky result: ${(value: string) => value}</div>
         <template slot="fallback" id=22>loading risky</template>
         <template slot="error" id=23>too risky</template>
     </template>

     <div slot="fallback" id=11>loading safe</div>
     <div slot="error" id=12>how does this even happen?</div>
</template>

  `;
});
