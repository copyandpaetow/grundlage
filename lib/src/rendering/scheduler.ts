import { finishUpdate, handleRendererError, RenderState, rerunCurrentRenderer } from "./generator-layer";

export interface Scheduler {
	flushPromise: Promise<void> | null;
	dirty: boolean;
}

export const createScheduler = (): Scheduler => ({
	flushPromise: null,
	dirty: false,
});

export const resetScheduler = (scheduler: Scheduler): void => {
	scheduler.flushPromise = null;
	scheduler.dirty = false;
};

export const runFlushLoop = async (
	scheduler: Scheduler,
	state: RenderState,
): Promise<void> => {
	await null; //batching window: a synchronous burst of update() calls coalesces onto this batch
	do {
		scheduler.dirty = false;
		try {
			await rerunCurrentRenderer(state); //resolves when this dispatch's DOM lands (sync or async)
		} catch (error) {
			//a render-fn threw synchronously before rerunCurrentRenderer resolved: bubble it, then
			//unstick the await so the loop can settle
			handleRendererError(state, error as Error);
			finishUpdate(state);
		}
	} while (scheduler.dirty);
	scheduler.flushPromise = null;
};
