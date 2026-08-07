import { getFormAssociatedBaseClass } from "./forms";
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
	classifyRenderResultAsOperation,
	createRenderTask,
	DriverStep,
	endTaskWithError,
	isParkedAtARenderableYield,
	isStillParkedAt,
	MODE,
	OPERATION,
	RELEASE_CONTROL,
	RenderOperation,
	stepTaskToNextOperation,
	Task,
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
			"grundlage: component(fn) expects a generator function. A plain function or arrow function is not accepted.",
		);
	const mergedOptions = { ...defaultOptions, ...options };
	const ParentClass: typeof HTMLElement = mergedOptions.formAssociated
		? getFormAssociatedBaseClass()
		: HTMLElement;

	class BaseElement extends ParentClass implements BaseComponent {
		#shadowRoot: ShadowRoot; //needs to be property as for mode: "closed" the this.shadowRoot is null
		#instance: Instance | null = null;
		#attributeObserver: MutationObserver | null = null;
		#isHydrationPending: boolean;
		#styleSheetMoveState: StyleSheetMoveState = {
			needsStyleSheetRefreshOnMove: false,
			needsRerenderAfterMove: false,
		};
		#outerTask: Task | null = null;
		#innerTask: Task | null = null;
		#currentRenderable: RenderFunction | ComponentGenerator | null = null;
		#currentRenderCallId = 0;
		#isScheduled = false;
		#pendingUpdate: PromiseWithResolvers<void> | null = null;
		#isServerRun = false;
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
			if (this.#outerTask) {
				const instance = this.#instance;
				if (instance) {
					refreshStyleSheetsAfterMove(instance);
					this.#rerenderIfStyleSheetsDemoted();
				}
				return;
			}
			this.#isServerRun = isServer();
			this.#outerTask = createRenderTask(componentGenerator(this));
			if (!this.#isServerRun) this.#setupAttributeObserver();
			this.#startRun(this.#outerTask);
		}

		async disconnectedCallback() {
			await Promise.resolve();
			if (this.isConnected) return;
			if (this.#outerTask === null) return;
			this.#cancelBothTasks();
			this.#teardownAttributeObserver();
			this.#resolvePendingUpdatePromise();
		}

		setProp(name: string, value: unknown, oldValue?: unknown) {
			applyDynamicAttribute(this, name, value, oldValue);
			this.update();
		}

		update(): Promise<void> {
			if (this.#outerTask === null || this.#currentRenderable === null)
				return Promise.resolve();
			return this.#scheduleNextUpdate();
		}

		#scheduleNextUpdate(): Promise<void> {
			this.#pendingUpdate ??= Promise.withResolvers<void>();
			if (!this.#isScheduled) {
				this.#isScheduled = true;
				queueMicrotask(() => {
					this.#isScheduled = false;
					this.#rerunCurrentRenderable();
				});
			}
			return this.#pendingUpdate.promise;
		}

		#rerunCurrentRenderable(): void {
			const outerTask = this.#outerTask;
			const renderable = this.#currentRenderable;
			if (outerTask === null || renderable === null)
				return this.#resolvePendingUpdatePromise();
			if (isGeneratorFunction(renderable)) {
				this.#startRun(
					this.#installInnerTask(renderable as ComponentGenerator),
				);
				return;
			}
			void this.#runTaskUntilItParksOrEnds(
				outerTask,
				this.#callRenderFunction(outerTask, renderable as RenderFunction),
			);
		}

		#resolvePendingUpdatePromise(): void {
			const updatePromise = this.#pendingUpdate;
			if (updatePromise === null) return;
			this.#pendingUpdate = null;
			updatePromise.resolve();
		}

		#installInnerTask(source: ComponentGenerator): Task {
			this.#cancelInnerTask();
			const innerTask = createRenderTask(source(this));
			this.#innerTask = innerTask;
			return innerTask;
		}

		#cancelInnerTask(): void {
			const innerTask = this.#innerTask;
			if (innerTask === null) return;
			this.#innerTask = null;
			this.#currentRenderCallId++;
			cancelTaskAndRunCleanup(innerTask);
		}

		#cancelBothTasks(): void {
			const innerTask = this.#innerTask;
			const outerTask = this.#outerTask;
			this.#innerTask = this.#outerTask = null;
			this.#currentRenderable = null;
			this.#currentRenderCallId++;
			cancelTaskAndRunCleanup(innerTask);
			cancelTaskAndRunCleanup(outerTask);
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

		#startRun(task: Task): void {
			void this.#runTaskUntilItParksOrEnds(
				task,
				stepTaskToNextOperation(task, MODE.SEND, undefined),
			);
		}

		async #runTaskUntilItParksOrEnds(
			startTask: Task,
			startStep: DriverStep,
		): Promise<void> {
			let task = startTask;
			let next = startStep;

			while (true) {
				switch (next.kind) {
					//the next step is not known yet — awaiting it is the only place this loop waits
					case OPERATION.DEFERRED:
						next = await next.payload;
						break;

					//stop: the task is waiting on something else now, or a newer render replaced this one
					case RELEASE_CONTROL.kind:
						return;

					//the generator yielded a template, so the component renders it itself and any
					//nested generator loses the markup
					case OPERATION.PAINT: {
						if (task === this.#outerTask) {
							this.#cancelInnerTask();
							this.#currentRenderable = null;
						}
						try {
							this.#paint(next.payload);
						} catch (error) {
							next = endTaskWithError(task, error);
							break;
						}
						if (this.#isServerRun) return this.#cancelBothTasks();
						next = stepTaskToNextOperation(task, MODE.SEND, this);
						break;
					}

					//the generator yielded a render function: calling it produces the next step which can be a
					//template to paint, a nested generator, a promise to wait on, or an error
					case OPERATION.CALL_RENDER_FUNCTION:
						if (task === this.#outerTask)
							this.#currentRenderable = next.payload;
						next = this.#callRenderFunction(task, next.payload);
						break;

					//the generator yielded or returned another generator: it runs until it parks, and
					//only then does the component's own generator continue past the yield that
					//installed it
					case OPERATION.INSTALL_FROM_YIELD:
					case OPERATION.INSTALL_FROM_RENDER_RESULT: {
						const theInstallerIsTheComponentGenerator =
							task === this.#outerTask;
						if (!theInstallerIsTheComponentGenerator) {
							next = endTaskWithError(
								task,
								new Error(
									"grundlage: an inner generator may not install another one — one level of nesting only",
								),
							);
							break;
						}

						if (next.kind === OPERATION.INSTALL_FROM_YIELD)
							this.#currentRenderable = next.payload;

						const theComponentGeneratorMayResumeOnceTheNestedOneParks =
							!this.#isServerRun && isParkedAtARenderableYield(task);
						const componentGeneratorResumePermit =
							theComponentGeneratorMayResumeOnceTheNestedOneParks
								? task.suspension
								: null;

						this.#startRun(this.#installInnerTask(next.payload));
						if (!isStillParkedAt(task, componentGeneratorResumePermit)) return;
						next = stepTaskToNextOperation(task, MODE.SEND, this);
						break;
					}

					//a promise the generator yielded resolved, so its value goes back into the generator
					case OPERATION.RESUME:
						next = stepTaskToNextOperation(task, MODE.SEND, next.payload);
						break;

					//that promise rejected instead: the error is thrown at the yield, where the
					//generator's own try/catch can take it
					case OPERATION.RESUME_WITH_ERROR:
						next = stepTaskToNextOperation(task, MODE.THROW, next.payload);
						break;

					//the generator returned; unless another run is already queued, this settles the
					//promise update() handed out
					case OPERATION.COMPLETED:
						if (this.#isServerRun) return this.#cancelBothTasks();
						if (!this.#isScheduled) this.#resolvePendingUpdatePromise();
						return;

					//every error ends up here: a nested generator's is thrown into the component's
					//generator, the component's own goes to #fail
					case OPERATION.ROUTE_ERROR: {
						const error = next.payload;
						const outerTask = this.#outerTask;
						if (task === outerTask || outerTask === null)
							return this.#fail(error);
						this.#cancelInnerTask();
						if (!isParkedAtARenderableYield(outerTask))
							return this.#fail(error);

						this.#currentRenderable = null;
						task = outerTask;
						next = stepTaskToNextOperation(outerTask, MODE.THROW, error);
						break;
					}

					default:
						return next satisfies never;
				}
			}
		}

		#callRenderFunction(
			task: Task,
			renderFunction: RenderFunction,
		): DriverStep {
			const renderCallId = ++this.#currentRenderCallId;
			let produced: unknown;
			try {
				produced = renderFunction(this);
			} catch (error) {
				return endTaskWithError(task, error);
			}
			return this.#dispatchRenderOperation(
				task,
				classifyRenderResultAsOperation(task, produced),
				renderCallId,
			);
		}

		//nothing here ever steps the generator in THROW mode: a render function's failure has no yield
		//to surface at, so it stays fatal instead of becoming catchable inside the generator
		#dispatchRenderOperation(
			task: Task,
			operation: RenderOperation,
			renderCallId: number,
		): DriverStep {
			switch (operation.kind) {
				case OPERATION.PAINT:
					if (task === this.#outerTask) this.#cancelInnerTask();
					try {
						this.#paint(operation.payload);
					} catch (error) {
						return endTaskWithError(task, error);
					}
					if (this.#isServerRun) {
						this.#cancelBothTasks();
						return RELEASE_CONTROL;
					}
					if (!isParkedAtARenderableYield(task)) {
						if (!this.#isScheduled) this.#resolvePendingUpdatePromise();
						return RELEASE_CONTROL;
					}
					return stepTaskToNextOperation(task, MODE.SEND, this);

				case OPERATION.AWAIT_RENDER_RESULT:
					return {
						kind: OPERATION.DEFERRED,
						payload: this.#settleRenderResult(
							task,
							operation.payload,
							renderCallId,
						),
					};

				case OPERATION.INSTALL_FROM_RENDER_RESULT:
				case OPERATION.ROUTE_ERROR:
					return operation;

				default:
					return operation satisfies never;
			}
		}

		async #settleRenderResult(
			task: Task,
			promise: Promise<unknown>,
			renderCallId: number,
		): Promise<DriverStep> {
			let value: unknown;
			try {
				value = await promise;
			} catch (error) {
				return this.#currentRenderCallId === renderCallId
					? endTaskWithError(task, error)
					: RELEASE_CONTROL;
			}
			if (this.#currentRenderCallId !== renderCallId) return RELEASE_CONTROL;

			return this.#dispatchRenderOperation(
				task,
				classifyRenderResultAsOperation(task, value),
				renderCallId,
			);
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
			if (this.#isServerRun) flushHostPayload(this);
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
	}

	return BaseElement;
};
