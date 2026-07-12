import { FormBase } from "./forms";
import { applyDynamicAttribute } from "./rendering/bindings/attribute-dynamic";
import {
	createPainter,
	paint,
	Painter,
	serverPaint,
	setupAttributeObserver,
	teardownPainter,
} from "./runtime/painter";
import {
	cancelTaskAndRunCleanup,
	createCleanStepOutcome,
	MODE,
	nextTaskStep,
	SteppedTask,
} from "./runtime/engine";
import {
	createRenderTask,
	createStepOutcome,
	nextOperation,
	OPERATION,
	ROLE,
	STEP_OUTCOME,
	Task,
	TASK_STATE,
} from "./runtime/task";
import { html as htmlValue } from "./template";
import {
	BaseComponent,
	ComponentConstructor,
	ComponentGenerator,
	ComponentOptions,
	RenderFunction,
	Template,
} from "./types";
import { isGeneratorFunction, isServer } from "./utils/guards";

export { props } from "./props";
export {
	type ComponentOptions,
	type BaseComponent,
	type Template,
} from "./types";
export { load, type LoadOptions } from "./load";

const CLIENT_OUTCOME = {
	SUSPENDED: 0,
	DONE: 1,
	THREW_UP: 2,
	FAILED: 3,
} as const;
type ClientOutcome = (typeof CLIENT_OUTCOME)[keyof typeof CLIENT_OUTCOME];

const defaultOptions: ComponentOptions = {
	clonable: true,
	delegatesFocus: true,
	mode: "open",
	serializable: true,
} as const;

export const html = htmlValue as unknown as (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => Template;

export const component = (
	componentGenerator: ComponentGenerator,
	options: ComponentOptions = defaultOptions,
): ComponentConstructor => {
	const mergedOptions = { ...defaultOptions, ...options };
	const ParentClass: typeof HTMLElement = options.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#painter: Painter;
		#outer: Task | null = null;
		#inner: Task | null = null;
		#renderer: ComponentGenerator | RenderFunction | null = null;
		#scheduled = false;
		#pendingUpdate: PromiseWithResolvers<void> | null = null;
		#internals: ElementInternals | null = null;

		get internals(): ElementInternals | null {
			return (this.#internals ??= this.attachInternals?.() ?? null);
		}

		constructor() {
			super();
			const existingRoot =
				this.shadowRoot ??
				(mergedOptions.mode === "closed" ? this.internals?.shadowRoot : null) ??
				null;
			const prerendered = existingRoot !== null;
			const shadowRoot = existingRoot ?? this.attachShadow(mergedOptions);
			this.#painter = createPainter(this, shadowRoot, prerendered);
		}

		connectedCallback() {
			if (this.#outer !== null) return;
			this.#outer = createRenderTask(ROLE.OUTER, componentGenerator(this));
			if (isServer()) return this.#runServerTask(this.#outer);
			setupAttributeObserver(this.#painter, () => this.update());
			this.#runTask(this.#outer);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			if (this.#outer === null) return;
			this.#cancelBothTasks();
			teardownPainter(this.#painter);
			this.#resolvePendingUpdatePromise();
		}

		setProp(name: string, value: unknown, oldValue?: unknown) {
			applyDynamicAttribute(this, name, value, oldValue);
			this.update();
		}

		update(): Promise<void> {
			if (this.#renderer === null) return Promise.resolve();
			return this.#scheduleNextUpdate();
		}

		#isTaskLive(task: Task): boolean {
			return (task.role === ROLE.INNER ? this.#inner : this.#outer) === task;
		}

		#resetInnerTask(source: ComponentGenerator): Task {
			cancelTaskAndRunCleanup(this.#inner);
			const inner = createRenderTask(ROLE.INNER, source(this));
			this.#inner = inner;
			return inner;
		}

		#cancelBothTasks(): void {
			const inner = this.#inner;
			const outer = this.#outer;
			this.#inner = this.#outer = this.#renderer = null;
			cancelTaskAndRunCleanup(inner);
			cancelTaskAndRunCleanup(outer);
		}

		#fail(error: unknown): void {
			this.#cancelBothTasks();
			teardownPainter(this.#painter);
			console.warn(error);
			this.#painter.shadowRoot.textContent = `${error}`;
			// the error text replaces the DOM these referenced; a reconnect must remount,
			// not patch the now-detached instance in place (same-hash reconcile would stick)
			this.#painter.instance = null;
			this.#painter.hostBindingCount = 0;
			this.#resolvePendingUpdatePromise();
		}

		#resolvePendingUpdatePromise(): void {
			const updatePromise = this.#pendingUpdate;
			if (updatePromise === null) return;
			this.#pendingUpdate = null;
			updatePromise.resolve();
		}

		#runTask(
			task: Task,
			start: SteppedTask = nextTaskStep(task, MODE.SEND, undefined),
		): ClientOutcome {
			let next = start;
			while (true) {
				if (next instanceof Promise) {
					next.then(
						(result) => {
							if (this.#isTaskLive(task))
								this.#runTask(task, createCleanStepOutcome(result));
						},
						(error) => {
							if (this.#isTaskLive(task))
								this.#runTask(
									task,
									createStepOutcome(STEP_OUTCOME.THREW, error),
								);
						},
					);
					return CLIENT_OUTCOME.SUSPENDED;
				}

				const operation = nextOperation(task, next);
				switch (operation.kind) {
					case OPERATION.PAINT:
						if (task.role === ROLE.OUTER) this.#renderer = null;
						try {
							paint(this.#painter, operation.payload);
						} catch (error) {
							next = createStepOutcome(STEP_OUTCOME.THREW, error);
							break;
						}
						next = nextTaskStep(task, MODE.SEND, this);
						break;

					case OPERATION.PAINT_FROM:
						if (task.role === ROLE.OUTER) this.#renderer = operation.payload;
						try {
							paint(this.#painter, operation.payload(this));
						} catch (error) {
							next = createStepOutcome(STEP_OUTCOME.THREW, error);
							break;
						}
						next = nextTaskStep(task, MODE.SEND, this);
						break;

					case OPERATION.RESUME:
						next = nextTaskStep(task, MODE.SEND, operation.payload);
						break;

					case OPERATION.INSTALL: {
						this.#renderer = operation.payload;
						const innerOutcome = this.#runTask(
							this.#resetInnerTask(operation.payload),
						);
						if (innerOutcome === CLIENT_OUTCOME.THREW_UP)
							return CLIENT_OUTCOME.THREW_UP;
						next = nextTaskStep(task, MODE.SEND, this);
						break;
					}

					case OPERATION.AWAIT: {
						const promise = operation.payload;
						promise.then(
							(value) => {
								if (this.#isTaskLive(task))
									this.#runTask(
										task,
										createStepOutcome(STEP_OUTCOME.RESUMED, value),
									);
							},
							(error) => {
								if (this.#isTaskLive(task))
									this.#runTask(
										task,
										createStepOutcome(STEP_OUTCOME.THREW, error),
									);
							},
						);
						return CLIENT_OUTCOME.SUSPENDED;
					}

					case OPERATION.THROW_TO_PARENT: {
						const error = operation.payload;
						cancelTaskAndRunCleanup(this.#inner);
						const parent = this.#outer;
						const parentCanCatch =
							parent !== null && parent.state === TASK_STATE.DRIVING;
						if (!parentCanCatch) {
							this.#fail(error);
							return CLIENT_OUTCOME.THREW_UP;
						}
						const reaction = nextTaskStep(parent, MODE.THROW, error);
						const dismissed =
							!(reaction instanceof Promise) &&
							reaction.kind === STEP_OUTCOME.RETURNED;
						//run the outer to whatever it did next: a re-yield paints a fallback, a
						//return completes it (cleanup captured, deferred to disconnect like COMPLETED)
						this.#runTask(parent, reaction);
						//a return left no live renderer — drop the dead child so update() can't re-run it
						if (dismissed) this.#renderer = null;
						return CLIENT_OUTCOME.THREW_UP;
					}

					case OPERATION.COMPLETED:
						if (task.role === ROLE.INNER) this.#resolvePendingUpdatePromise();
						return CLIENT_OUTCOME.DONE;

					case OPERATION.FAIL:
						this.#fail(operation.payload);
						return CLIENT_OUTCOME.FAILED;

					case OPERATION.NOOP:
						return CLIENT_OUTCOME.SUSPENDED;
				}
			}
		}

		#rerunCurrentRenderer(): void {
			const renderer = this.#renderer;
			if (renderer === null) return this.#resolvePendingUpdatePromise();
			if (!isGeneratorFunction(renderer)) {
				try {
					paint(this.#painter, (renderer as RenderFunction)(this));
					this.#resolvePendingUpdatePromise();
				} catch (error) {
					this.#fail(error);
				}
				return;
			}
			this.#runTask(this.#resetInnerTask(renderer as ComponentGenerator));
		}

		#scheduleNextUpdate(): Promise<void> {
			this.#pendingUpdate ??= Promise.withResolvers<void>();
			if (!this.#scheduled) {
				this.#scheduled = true;
				queueMicrotask(() => {
					this.#scheduled = false;
					this.#rerunCurrentRenderer();
				});
			}
			return this.#pendingUpdate.promise;
		}

		//unlike the client, server continuations need no isTaskLive supersession guard: a
		//render runs to exactly one paint (which ends it via #cancelBothTasks) and the outer
		//is never resumed after INSTALL, so no superseded continuation can ever exist here
		#runServerTask(
			task: Task,
			start: SteppedTask = nextTaskStep(task, MODE.SEND, undefined),
		): void {
			let next = start;
			while (true) {
				if (next instanceof Promise) {
					next.then(
						(result) =>
							this.#runServerTask(task, createCleanStepOutcome(result)),
						(error) => this.#fail(error),
					);
					return;
				}

				const operation = nextOperation(task, next);
				switch (operation.kind) {
					case OPERATION.PAINT:
					case OPERATION.PAINT_FROM: {
						try {
							const template =
								operation.kind === OPERATION.PAINT
									? operation.payload
									: (operation.payload as RenderFunction)(this);
							serverPaint(this.#painter, template);
						} catch (error) {
							next = createStepOutcome(STEP_OUTCOME.THREW, error);
							break;
						}
						return this.#cancelBothTasks();
					}

					case OPERATION.INSTALL:
						return this.#runServerTask(this.#resetInnerTask(operation.payload));

					case OPERATION.RESUME:
						next = nextTaskStep(task, MODE.SEND, operation.payload);
						break;

					case OPERATION.AWAIT:
						operation.payload.then(
							(value) =>
								this.#runServerTask(
									task,
									createStepOutcome(STEP_OUTCOME.RESUMED, value),
								),
							(error) => this.#fail(error),
						);
						return;

					case OPERATION.THROW_TO_PARENT: {
						const error = operation.payload;
						cancelTaskAndRunCleanup(this.#inner);
						const parent = this.#outer;
						if (parent !== null && parent.state === TASK_STATE.DRIVING)
							return this.#runServerTask(
								parent,
								nextTaskStep(parent, MODE.THROW, error),
							);
						return this.#fail(error);
					}

					case OPERATION.COMPLETED:
						return this.#cancelBothTasks();

					case OPERATION.FAIL:
						return this.#fail(operation.payload);

					case OPERATION.NOOP:
						return;
				}
			}
		}
	}

	return BaseElement;
};
