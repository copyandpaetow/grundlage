import { defaultWhen } from "../mount/mount";

export const ASYNC_STATES = {
	IDLE: -1,
	ERROR: 0,
	LOADING: 1,
	SUCCESS: 2,
} as const;

export type ValueOf<T> = T[keyof T];

export interface Effect {
	execute: VoidFunction;
	dependencies: Set<Set<Effect>>;
	parent: Effect;
	children: Set<Effect>;
	cleanupEffects: Set<VoidFunction>;
	dirty: boolean;
}

export type InternalAsyncSignal = {
	error: SignalGetter<Error>;
	status: SignalGetter<ValueOf<typeof ASYNC_STATES>>;
	refetch: VoidFunction;
};

export type AsyncSignalGetter<Value> = SignalGetter<Value> &
	InternalAsyncSignal;
type AsyncSignal<Value> = [AsyncSignalGetter<Value>, SignalSetter<Value>];

export type SignalSetter<Value> = (
	newValue: Value | ((prevValue: Value) => Value)
) => void;
export type SignalGetter<Value> = () => Value;
export type Signal<Value> = [SignalGetter<Value>, SignalSetter<Value>];

export type CreateSignalFn = <Value>(initialValue: Value) => Signal<Value>;

type ComputedFn = <Value>(
	fn: (isToplevel: boolean) => Value
) => SignalGetter<Value>;

type CreateAsyncFn = <Value>(
	createPromise: () => Promise<Value>,
	trigger?: SignalGetter<unknown>
) => AsyncSignal<Value>;

type RefFn = () => (
	...args: [] | [Node] | [Node, Node]
) => Array<Node> | Node | undefined;

type FromSignalFn = <Value>(externalSignal: Signal<Value>) => Signal<Value>;

export type Reactivity = {
	create: CreateSignalFn;
	createAsync: CreateAsyncFn;
	computed: ComputedFn;
	ref: RefFn;
	dispose: VoidFunction;
	fromSignal: FromSignalFn;
	context: Effect[];
	onCleanup: (callback: VoidFunction) => void;
};

export const cleanup = (effect: Effect) => {
	for (const dependency of effect.dependencies) {
		dependency.delete(effect);
	}
	effect.children.forEach(cleanup);
	effect.cleanupEffects.forEach((cb) => cb());
	effect.dependencies.clear();
	effect.children.clear();
	effect.cleanupEffects.clear();

	effect.parent = undefined;
};

const isChainDirty = (effect: Effect): boolean => {
	let current = effect;
	while (current) {
		if (current.dirty) return true;
		current = current.parent;
	}
	return false;
};

export const createSignalReactivity = (): Reactivity => {
	const context: Array<Effect> = [];

	const createSignal: CreateSignalFn = <Value>(initialValue: Value) => {
		const subscriptions = new Set<Effect>();
		let value = initialValue;

		const read: SignalGetter<Value> = () => {
			const observer = context.at(-1);
			if (observer) {
				subscriptions.add(observer);
				observer.dependencies.add(subscriptions);
			}
			return value;
		};

		const write: SignalSetter<Value> = (newValue) => {
			const newValueResult =
				typeof newValue === "function"
					? (newValue as (prevValue: Value) => Value)(value)
					: newValue;

			if (newValueResult === value) {
				return;
			}

			value = newValueResult;
			[...subscriptions].forEach((observer) => {
				if (observer.dependencies.size > 0) {
					observer.dirty = true;
					observer.execute();
				} else {
					subscriptions.delete(observer);
				}
			});
		};

		return [read, write];
	};

	const fromSignal: FromSignalFn = <Value>([
		externalRead,
		externalWrite,
	]: Signal<Value>): Signal<Value> => {
		const subscriptions = new Set<Effect>();

		const read: SignalGetter<Value> = () => {
			const observer = context.at(-1);
			if (observer) {
				subscriptions.add(observer);
				observer.dependencies.add(subscriptions);
			}
			return externalRead();
		};

		return [read, externalWrite];
	};

	const onCleanup = (callback: VoidFunction) => {
		context.at(-1)?.cleanupEffects.add(callback);
	};

	const computed: ComputedFn = <Value>(
		callback: (isToplevel: boolean) => Value
	) => {
		const [result, setResult] = createSignal(undefined);
		const parentEffect = context.at(-1);

		const effect = {
			execute() {
				cleanup(effect);
				context.push(effect);
				setResult(callback(isChainDirty(effect)));
				context.pop();
				effect.dirty = false;

				if (!effect.parent || effect.dependencies.size > 0) {
					return;
				}
				effect.children.forEach((child) => {
					parentEffect.children.add(child);
					child.parent = parentEffect;
					parentEffect.cleanupEffects = parentEffect.cleanupEffects.union(
						effect.cleanupEffects
					);
				});
				effect.children.clear();
				effect.parent = undefined;
			},
			dependencies: new Set<Set<Effect>>(),
			parent: parentEffect,
			children: new Set<Effect>(),
			cleanupEffects: new Set<VoidFunction>(),
			dirty: false,
		};

		if (parentEffect) {
			parentEffect.children.add(effect);
		}

		effect.execute();

		return result;
	};

	const ref: RefFn = () => {
		const nodes: Array<Node> = [];

		const updateNode = (
			...args: [] | [Node] | [Node, Node]
		): Array<Node> | Node | undefined => {
			if (args.length === 2) {
				nodes.length = 0;
				const [start, end] = args;
				let current = start.nextSibling;
				while (current && current !== end) {
					const next = current.nextSibling;
					nodes.push(current);
					current = next;
				}
				return nodes;
			}

			if (args.length === 1) {
				nodes.length = 0;
				nodes.push(args.at(0));
				return nodes.at(0);
			}

			if (nodes.length > 1) {
				return nodes;
			}

			return nodes.at(0);
		};

		return updateNode;
	};

	const createAsyncSignal: CreateAsyncFn = <Value>(
		createPromise: () => Promise<Value>,
		trigger = defaultWhen as SignalGetter<unknown>
	) => {
		const [result, setResult] = createSignal<Value | undefined>(undefined);
		const [error, setError] = createSignal<Error | undefined>(undefined);
		const [status, setStatus] = createSignal<ValueOf<typeof ASYNC_STATES>>(
			ASYNC_STATES.IDLE
		);

		let current = createPromise;
		let abort: AbortController | null = null;

		const refreshAbort = () => {
			if (!abort || abort.signal.aborted) {
				abort = new AbortController();
			}
		};

		const handleAsync = async (
			promiseFactory: (trigger: unknown) => Promise<Value>
		) => {
			refreshAbort();
			let isAborted = false;

			const onAbort = () => {
				console.log("aborted");
				isAborted = true;
			};
			abort.signal.addEventListener("abort", onAbort, { once: true });

			try {
				setStatus(ASYNC_STATES.LOADING);
				const result = await promiseFactory(trigger());
				if (!isAborted) {
					setResult(result);
					setStatus(ASYNC_STATES.SUCCESS);
				}
			} catch (error) {
				if (!isAborted) {
					setStatus(ASYNC_STATES.ERROR);
					setError(error);
				}
			} finally {
				abort.signal.removeEventListener("abort", onAbort);
			}
		};

		computed(() => {
			const shouldStart = trigger();

			if (!shouldStart) {
				return;
			}

			abort?.abort("triggered");
			handleAsync(current);
		});

		const setPromise: SignalSetter<Value> = (newValue) => {
			if (typeof newValue === "function") {
				//@ts-expect-error too new for typescript
				current = Promise.try(newValue);
				handleAsync(current);
			} else setResult(newValue);
		};

		//@ts-expect-error
		result.error = error;
		//@ts-expect-error
		result.status = status;
		//@ts-expect-error
		result.refetch = () => {
			abort?.abort("refetch");
			handleAsync(current);
		};

		return [result, setPromise] as AsyncSignal<Value>;
	};

	return {
		create: createSignal,
		createAsync: createAsyncSignal,
		computed,
		onCleanup,
		context,
		ref,
		fromSignal,
		dispose() {
			context.length = 0;
		},
	};
};
