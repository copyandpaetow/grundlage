const executionStack: Array<Effect> = [];

class Effect extends EventTarget {
	#callback: Function;
	#value: Signal;
	#abortController: AbortController;

	constructor(cb: Function) {
		super();
		this.#callback = cb;
		this.#abortController = new AbortController();
		this.#value = new Signal(undefined);
		this.#run();
	}

	#run() {
		this.dispatchEvent(new CustomEvent("effect-release"));

		executionStack.forEach((ancestorEffect) =>
			ancestorEffect.addEventListener(
				"effect-release",
				() => {
					this.abort();
				},
				{ signal: this.#abortController.signal }
			)
		);

		executionStack.push(this);

		try {
			this.#value.set(this.#callback());
		} finally {
			executionStack.pop();
		}
	}

	get() {
		return this.#value.get();
	}

	abort() {
		this.#abortController.abort();
		this.#abortController = new AbortController();
	}

	subscribe(signal: Signal | Effect) {
		signal.addEventListener(
			"signal-change",
			() => {
				this.abort();
				this.#run();
			},
			{ signal: this.#abortController.signal, once: true }
		);
		this.addEventListener(
			"effect-release",
			() => {
				signal.abort();
			},
			{ signal: this.#abortController.signal, once: true }
		);
	}
}

export const createEffect = (cb: Function) => {
	const effect = new Effect(cb);

	return () => effect.get();
};

class Signal extends EventTarget {
	#value: unknown;
	#aborted: boolean = false;

	constructor(initialValue: unknown) {
		super();
		this.#value = initialValue;
	}

	abort() {
		this.#aborted = true;
	}

	get() {
		if (!this.#aborted) {
			executionStack.at(-1)?.subscribe(this);
		}
		return this.#value;
	}

	set(newValue: unknown) {
		if (newValue === this.#value || this.#aborted) {
			return this.#value;
		}

		this.#value = newValue;
		this.dispatchEvent(new CustomEvent("signal-change"));

		return this.#value;
	}
}

export const createSignal = (
	initialValue: unknown
): [() => unknown, (newValue: unknown) => unknown] => {
	const signal = new Signal(initialValue);

	return [() => signal.get(), (newValue) => signal.set(newValue)];
};

// const [s1, setS1] = createSignal(1);
// const [s2, setS2] = createSignal(2);

// const outerResult = createEffect(() => {
// 	const sum = s1() + s2();
// 	const [s3, setS3] = createSignal(3);
// 	console.log("effect", sum);

// 	const result = createEffect(() => {
// 		const factor = s1() * s2() * s3();
// 		console.log("---inner effect", factor);
// 		return factor;
// 	});
// 	console.log("---inner result", result());
// 	//setS3(4); //this setter recalls the outer effects as well somehow
// 	return sum;
// });

// console.log("outer resut", outerResult());

// setS2(5);
// createEffect(() => {
// 	console.log("outer resut", outerResult());
// });

// setS2(6);
// setS2(15);
// setS2(20);
// setS1(0);
// setS1(2);
// setS1(2);
