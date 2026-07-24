import { FormBase } from "./forms";
import { applyDynamicAttribute } from "./rendering/bindings/attribute-dynamic";
import {
	commitLiveBinding,
	createLiveBinding,
	revertHostBinding,
} from "./rendering/bindings/dispatch";
import { StyleSheetMoveState } from "./rendering/bindings/types";
import { flushHostPayload, warnOnUnclaimedSsrPayloads } from "./load";
import { getParsedTemplate } from "./parser/html";
import { ParsedTemplate } from "./parser/types";
import { coerceToTemplate, TemplateValue } from "./template";
import {
	cancelTaskAndRunCleanup,
	createCleanStepOutcome,
	createRenderTask,
	createStepOutcome,
	MODE,
	nextOperation,
	nextTaskStep,
	OPERATION,
	ROLE,
	STEP_OUTCOME,
	SteppedTask,
	Task,
	TASK_STATE,
} from "./runtime/task";
import { html as htmlValue } from "./template";
import {
	hydrateInstance,
	Instance,
	reconcileInstance,
	refreshStyleSheetsAfterMove,
	releaseInstance,
} from "./rendering/instance";
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
	if (!isGeneratorFunction(componentGenerator))
		throw new TypeError(
			"grundlage: component(fn) expects a generator function — write `component(function* (host) { … })` " +
				"or `component(async function* (host) { … })`. A plain function or arrow function is not accepted.",
		);
	const mergedOptions = { ...defaultOptions, ...options };
	const ParentClass: typeof HTMLElement = mergedOptions.formAssociated
		? FormBase
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#shadowRoot: ShadowRoot;
		#instance: Instance | null = null;
		#attributeObserver: MutationObserver | null = null;
		#isHydrationPending: boolean;
		#styleSheetMoveState: StyleSheetMoveState = {
			needsStyleSheetRefreshOnMove: false,
			needsRerenderAfterMove: false,
		};
		#outer: Task | null = null;
		#inner: Task | null = null;
		#renderer: ComponentGenerator | RenderFunction | null = null;
		#isScheduled = false;
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
			this.#isHydrationPending = existingRoot !== null;
			this.#shadowRoot = existingRoot ?? this.attachShadow(mergedOptions);
		}

		connectedCallback() {
			if (this.#outer) {
				const instance = this.#instance;
				if (instance) {
					refreshStyleSheetsAfterMove(instance);
					this.#rerenderIfStyleSheetsDemoted();
				}
				return;
			}
			this.#outer = createRenderTask(ROLE.OUTER, componentGenerator(this));
			if (isServer()) return this.#runServerTask(this.#outer);
			this.#setupAttributeObserver();
			this.#runTask(this.#outer);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			if (this.#outer === null) return;
			this.#cancelBothTasks();
			this.#teardownAttributeObserver();
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
			this.#revertAllHostBindings();
			this.#teardownAttributeObserver();
			console.warn(error);
			this.#shadowRoot.textContent = `${error}`;
			this.#instance = null;
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
		): boolean {
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
					return false;
				}

				const operation = nextOperation(task, next);
				switch (operation.kind) {
					case OPERATION.PAINT:
					case OPERATION.PAINT_FROM:
						if (task.role === ROLE.OUTER)
							this.#renderer =
								operation.kind === OPERATION.PAINT_FROM
									? operation.payload
									: null;
						try {
							const template =
								operation.kind === OPERATION.PAINT
									? operation.payload
									: (operation.payload as RenderFunction)(this);
							this.#paint(template);
						} catch (error) {
							next = createStepOutcome(STEP_OUTCOME.THREW, error);
							break;
						}
						next = nextTaskStep(task, MODE.SEND, this);
						break;

					case OPERATION.RESUME:
						next = nextTaskStep(task, MODE.SEND, operation.payload);
						break;

					case OPERATION.THROW_INTO:
						next = nextTaskStep(task, MODE.THROW, operation.payload);
						break;

					case OPERATION.INSTALL: {
						this.#renderer = operation.payload;
						const innerThrewToParent = this.#runTask(
							this.#resetInnerTask(operation.payload),
						);
						if (innerThrewToParent) return true;
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
						return false;
					}

					case OPERATION.THROW_TO_PARENT: {
						const error = operation.payload;
						cancelTaskAndRunCleanup(this.#inner);
						const parent = this.#outer;
						const parentCanCatch =
							parent && parent.state === TASK_STATE.DRIVING;
						if (!parentCanCatch) {
							this.#fail(error);
							return true;
						}
						const reaction = nextTaskStep(parent, MODE.THROW, error);
						const isDismissed =
							!(reaction instanceof Promise) &&
							reaction.kind === STEP_OUTCOME.RETURNED;
						this.#runTask(parent, reaction);
						if (isDismissed) this.#renderer = null;
						return true;
					}

					case OPERATION.COMPLETED:
						if (task.role === ROLE.INNER) this.#resolvePendingUpdatePromise();
						return false;

					case OPERATION.FAIL:
						this.#fail(operation.payload);
						return false;

					case OPERATION.NOOP:
						return false;
				}
			}
		}

		#rerunCurrentRenderer(): void {
			const renderer = this.#renderer;
			if (renderer === null) return this.#resolvePendingUpdatePromise();
			if (!isGeneratorFunction(renderer)) {
				try {
					this.#paint((renderer as RenderFunction)(this));
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
			if (!this.#isScheduled) {
				this.#isScheduled = true;
				queueMicrotask(() => {
					this.#isScheduled = false;
					this.#rerunCurrentRenderer();
				});
			}
			return this.#pendingUpdate.promise;
		}

		#paint(value: unknown): void {
			const templateValue = coerceToTemplate(value);
			const parsed = getParsedTemplate(templateValue.__templateStrings);

			this.#attributeObserver?.disconnect();
			try {
				if (this.#isHydrationPending) {
					this.#hydrateRoot(templateValue, parsed);
					this.#isHydrationPending = false;
					warnOnUnclaimedSsrPayloads(this.#shadowRoot);
				} else {
					this.#paintRoot(templateValue, parsed);
				}
			} finally {
				this.#attributeObserver?.observe(this, { attributes: true });
			}
			this.#rerenderIfStyleSheetsDemoted();
		}

		#paintRoot(value: TemplateValue, parsed: ParsedTemplate): void {
			const mounted = reconcileInstance(
				this.#instance,
				value,
				this.#styleSheetMoveState,
			);
			if (!mounted) return;
			if (this.#instance) releaseInstance(this.#instance);
			this.#revertAllHostBindings();
			for (let index = 0; index < parsed.hostBindingCount; index++) {
				const live = createLiveBinding(parsed.bindings[index], this);
				commitLiveBinding(mounted.instance, live, value.values);
				mounted.instance.liveBindings[index] = live;
			}
			this.#shadowRoot.replaceChildren(mounted.fragment);
			this.#instance = mounted.instance;
		}

		#hydrateRoot(value: TemplateValue, parsed: ParsedTemplate): void {
			const instance = hydrateInstance(
				value,
				this.#shadowRoot,
				this.#styleSheetMoveState,
			);
			for (let index = 0; index < parsed.hostBindingCount; index++) {
				const live = createLiveBinding(parsed.bindings[index], this);
				commitLiveBinding(instance, live, value.values);
				instance.liveBindings[index] = live;
			}
			this.#instance = instance;
		}

		#serverPaint(value: unknown): void {
			const templateValue = coerceToTemplate(value);
			this.#paintRoot(
				templateValue,
				getParsedTemplate(templateValue.__templateStrings),
			);
			flushHostPayload(this);
		}

		#revertAllHostBindings(): void {
			const instance = this.#instance;
			if (!instance) return;
			const liveBindings = instance.liveBindings;
			for (let index = 0; index < instance.parsed.hostBindingCount; index++)
				revertHostBinding(liveBindings[index]);
		}

		//a deep stylesheet demote during the move walk has no host in scope, so it flags the
		//move state instead of re-rendering; the two element-level walk sites drain it here
		#rerenderIfStyleSheetsDemoted(): void {
			if (!this.#styleSheetMoveState.needsRerenderAfterMove) return;
			this.#styleSheetMoveState.needsRerenderAfterMove = false;
			this.update();
		}

		#setupAttributeObserver(): void {
			this.#attributeObserver?.disconnect();
			const observer = new MutationObserver(() => this.update());
			observer.observe(this, { attributes: true });
			this.#attributeObserver = observer;
		}

		#teardownAttributeObserver(): void {
			this.#attributeObserver?.disconnect();
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
							this.#serverPaint(template);
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

					case OPERATION.THROW_INTO:
						next = nextTaskStep(task, MODE.THROW, operation.payload);
						break;

					case OPERATION.AWAIT:
						operation.payload.then(
							(value) =>
								this.#runServerTask(
									task,
									createStepOutcome(STEP_OUTCOME.RESUMED, value),
								),
							(error) =>
								this.#runServerTask(
									task,
									createStepOutcome(STEP_OUTCOME.THREW, error),
								),
						);
						return;

					case OPERATION.THROW_TO_PARENT: {
						const error = operation.payload;
						cancelTaskAndRunCleanup(this.#inner);
						const parent = this.#outer;
						if (parent && parent.state === TASK_STATE.DRIVING)
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
