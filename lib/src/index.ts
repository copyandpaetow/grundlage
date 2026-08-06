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
	classifySettledStepAsOperation,
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
	Suspension,
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
			this.#runOperationsUntilControlIsReleased(
				this.#outerTask,
				stepTaskToNextOperation(this.#outerTask, MODE.SEND, undefined),
			);
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
				const branch = this.#installInnerTask(renderable as ComponentGenerator);
				return this.#runOperationsUntilControlIsReleased(
					branch,
					stepTaskToNextOperation(branch, MODE.SEND, undefined),
				);
			}
			this.#runOperationsUntilControlIsReleased(
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

		#runOperationsUntilControlIsReleased(
			startTask: Task,
			startStep: DriverStep,
		): void {
			let task = startTask;
			let next = startStep;
			let bodyAwaitingResumption: Task | null = null;
			let bodySuspensionAtInstall: Suspension | null = null;

			while (true) {
				if (next instanceof Promise) {
					this.#resumeCoroutineWhenPendingStepSettles(task, next);
					next = RELEASE_CONTROL;
					continue;
				}

				switch (next.kind) {
					case RELEASE_CONTROL.kind: {
						const body = bodyAwaitingResumption;
						if (body === null) return;
						bodyAwaitingResumption = null;
						if (!isStillParkedAt(body, bodySuspensionAtInstall)) return;
						task = body;
						next = stepTaskToNextOperation(body, MODE.SEND, this);
						break;
					}

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

					case OPERATION.CALL_RENDER_FUNCTION:
						if (task === this.#outerTask)
							this.#currentRenderable = next.payload;
						next = this.#callRenderFunction(task, next.payload);
						break;

					case OPERATION.INSTALL_FROM_YIELD:
					case OPERATION.INSTALL_FROM_RENDER_RESULT: {
						const theInstallerIsTheComponentBody = task === this.#outerTask;
						if (!theInstallerIsTheComponentBody) {
							next = endTaskWithError(
								task,
								new Error(
									"grundlage: an inner generator may not install another one — one level of nesting only",
								),
							);
							break;
						}
						//a generator the body yielded becomes the refire target; one a render function
						//returned does not, so update() re-calls the function and re-picks the branch
						if (next.kind === OPERATION.INSTALL_FROM_YIELD)
							this.#currentRenderable = next.payload;
						//only a renderable yield is somewhere to resume to, and on the server the branch
						//owns the markup — so the body is not queued at all in either case
						const theBodyWillResumeOnceTheBranchParks =
							!this.#isServerRun && isParkedAtARenderableYield(task);
						if (theBodyWillResumeOnceTheBranchParks) {
							bodyAwaitingResumption = task;
							bodySuspensionAtInstall = task.suspension;
						}
						task = this.#installInnerTask(next.payload);
						next = stepTaskToNextOperation(task, MODE.SEND, undefined);
						break;
					}

					case OPERATION.RESUME:
						next = stepTaskToNextOperation(task, MODE.SEND, next.payload);
						break;

					case OPERATION.AWAIT:
						this.#resumeCoroutineWhenYieldedPromiseSettles(task, next.payload);
						next = RELEASE_CONTROL;
						break;

					case OPERATION.COMPLETED:
						if (this.#isServerRun) return this.#cancelBothTasks();
						//a pass queued DURING this one (a render-time update()) resolves it instead
						if (!this.#isScheduled) this.#resolvePendingUpdatePromise();
						next = RELEASE_CONTROL;
						break;

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

		#resumeCoroutineWhenPendingStepSettles(
			task: Task,
			step: Promise<IteratorResult<unknown>>,
		): void {
			const suspension = task.suspension;
			step.then(
				(result) => {
					if (!isStillParkedAt(task, suspension)) return;
					this.#runOperationsUntilControlIsReleased(
						task,
						classifySettledStepAsOperation(task, result),
					);
				},
				(error) => {
					if (!isStillParkedAt(task, suspension)) return;
					this.#runOperationsUntilControlIsReleased(
						task,
						endTaskWithError(task, error),
					);
				},
			);
		}

		#resumeCoroutineWhenYieldedPromiseSettles(
			task: Task,
			promise: Promise<unknown>,
		): void {
			const suspension = task.suspension;
			promise.then(
				(value) => {
					if (isStillParkedAt(task, suspension))
						this.#runOperationsUntilControlIsReleased(
							task,
							stepTaskToNextOperation(task, MODE.SEND, value),
						);
				},
				(error) => {
					if (isStillParkedAt(task, suspension))
						this.#runOperationsUntilControlIsReleased(
							task,
							stepTaskToNextOperation(task, MODE.THROW, error),
						);
				},
			);
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

		//this lane cannot step in THROW mode, which is what keeps a rejected render promise fatal
		//rather than thrown into the generator that yielded the render function
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
						//a pass queued DURING this one (a render-time update()) resolves it instead
						if (!this.#isScheduled) this.#resolvePendingUpdatePromise();
						return RELEASE_CONTROL;
					}
					return stepTaskToNextOperation(task, MODE.SEND, this);

				case OPERATION.AWAIT_RENDER_RESULT:
					this.#continueRenderWhenPromiseSettles(
						task,
						operation.payload,
						renderCallId,
					);
					return RELEASE_CONTROL;

				case OPERATION.INSTALL_FROM_RENDER_RESULT:
				case OPERATION.ROUTE_ERROR:
					return operation;

				default:
					return operation satisfies never;
			}
		}

		#continueRenderWhenPromiseSettles(
			task: Task,
			promise: Promise<unknown>,
			renderCallId: number,
		): void {
			promise.then(
				(value) => {
					if (this.#currentRenderCallId !== renderCallId) return;
					this.#runOperationsUntilControlIsReleased(
						task,
						this.#dispatchRenderOperation(
							task,
							classifyRenderResultAsOperation(task, value),
							renderCallId,
						),
					);
				},
				(error) => {
					if (this.#currentRenderCallId !== renderCallId) return;
					this.#runOperationsUntilControlIsReleased(
						task,
						endTaskWithError(task, error),
					);
				},
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
